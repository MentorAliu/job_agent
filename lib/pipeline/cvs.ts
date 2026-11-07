import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { builtCv, file } from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { BuiltCvStatus, CvBuildRequest } from "@/lib/schemas/cv-builder";
import type { ClaimCheck, CvContent } from "@/lib/schemas/tailor";
import { getStorage } from "@/lib/storage";

// Built CVs for the build-cv steps. Inngest runs these with no signed-in
// user, so they live here rather than in lib/dal.

export type CvBuild = {
  id: string;
  request: CvBuildRequest;
  snapshotId: string;
  status: BuiltCvStatus;
  content: CvContent | null;
  keywords: string[] | null;
  claimFlags: ClaimCheck | null;
  /** Bullets already left out to fit, when the CV is drawn again. */
  trimmed: number;
};

export async function getCvBuild(id: string): Promise<CvBuild | null> {
  const [row] = await db
    .select({
      id: builtCv.id,
      request: builtCv.request,
      snapshotId: builtCv.snapshotId,
      status: builtCv.status,
      content: builtCv.content,
      keywords: builtCv.keywords,
      claimFlags: builtCv.claimFlags,
      trimmed: builtCv.trimmed,
    })
    .from(builtCv)
    .where(eq(builtCv.id, id));
  return row ?? null;
}

const GOING: BuiltCvStatus[] = ["writing", "checking", "rendering"];

/** Saves what Claude wrote, with the code check's flags. */
export async function saveCvContent(
  id: string,
  content: CvContent,
  keywords: string[],
  claimFlags: ClaimCheck,
): Promise<void> {
  await db
    .update(builtCv)
    .set({ content, keywords, claimFlags, status: "checking" })
    .where(and(eq(builtCv.id, id), eq(builtCv.status, "writing")));
}

/** Saves the claim check, Claude's half included, and moves on to the PDF. */
export async function setCvClaimCheck(
  id: string,
  claimFlags: ClaimCheck,
): Promise<void> {
  await db
    .update(builtCv)
    .set({ claimFlags, status: "rendering" })
    .where(and(eq(builtCv.id, id), inArray(builtCv.status, GOING)));
}

/**
 * Stores the PDF and makes the CV ready, with the content as drawn: the
 * bullets left out to fit the length are gone from it. Drawing again (a
 * retried step) replaces the same file.
 */
export async function saveCvPdf(
  id: string,
  drawn: {
    content: CvContent;
    bytes: Uint8Array;
    pages: number;
    trimmed: number;
  },
): Promise<void> {
  const storageKey = `cvs/${id}.pdf`;
  await getStorage().put(storageKey, drawn.bytes);
  const values = {
    kind: "document_pdf" as const,
    storageKey,
    mime: "application/pdf",
    sizeBytes: drawn.bytes.byteLength,
    sha256: createHash("sha256").update(drawn.bytes).digest("hex"),
  };
  await db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(file)
      .values(values)
      .onConflictDoUpdate({ target: file.storageKey, set: values })
      .returning({ id: file.id });
    await tx
      .update(builtCv)
      .set({
        pdfFileId: stored.id,
        content: drawn.content,
        pageCount: drawn.pages,
        trimmed: drawn.trimmed,
        status: "ready",
        error: null,
        readyAt: new Date(),
      })
      .where(eq(builtCv.id, id));
  });
}

/** Ends a build as failed, with a message its page shows. */
export async function failCvBuild(id: string, message: string): Promise<void> {
  await db
    .update(builtCv)
    .set({ status: "failed", error: message })
    .where(and(eq(builtCv.id, id), inArray(builtCv.status, GOING)));
}
