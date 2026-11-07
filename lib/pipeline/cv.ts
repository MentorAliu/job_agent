import "server-only";

import { and, eq, isNotNull, ne } from "drizzle-orm";
import mammoth from "mammoth";

import { file, profile, profileSnapshot } from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { MasterProfile } from "@/lib/schemas/profile";

import { getStorage } from "@/lib/storage";

import { keepScoringBaseline } from "./rescore";

// Database and storage access for step 1 of the pipeline. Inngest runs these
// with no signed-in user, so they live here rather than in lib/dal, where
// every function checks the session.

export type CvUpload = {
  id: string;
  storageKey: string;
  mime: string;
  originalName: string | null;
  anthropicFileId: string | null;
};

export async function getCvUpload(fileId: string): Promise<CvUpload | null> {
  const [row] = await db
    .select({
      id: file.id,
      storageKey: file.storageKey,
      mime: file.mime,
      originalName: file.originalName,
      anthropicFileId: file.anthropicFileId,
    })
    .from(file)
    .where(and(eq(file.id, fileId), eq(file.kind, "cv_upload")));
  return row ?? null;
}

export async function readCvBytes(upload: CvUpload): Promise<Uint8Array> {
  const bytes = await getStorage().get(upload.storageKey);
  if (!bytes) throw new Error(`The uploaded CV ${upload.id} is missing.`);
  return bytes;
}

/** A DOCX that can't be turned into text. Retrying won't help. */
export class DocxTextError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocxTextError";
  }
}

/** Turns a DOCX into plain text, as SPEC step 1 asks. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
  } catch (error) {
    throw new DocxTextError(
      "This Word file couldn't be opened. Save it again, or upload a PDF.",
      { cause: error },
    );
  }
  const text = value.trim();
  if (!text) {
    throw new DocxTextError(
      "This Word file has no text in it. Upload a PDF instead.",
    );
  }
  return text;
}

/** Pages of a PDF read for its text; a CV is never longer. */
const MAX_PDF_PAGES = 20;

/**
 * A PDF's text, for a command-line agent, which can't read the PDF itself.
 * Null when it has none, such as a scan, or can't be opened: the API then
 * reads the PDF as it is.
 */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<string | null> {
  let lib: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    // On a server pdf.js runs its worker's code on this thread. Loaded here,
    // the worker is in the bundle, rather than looked for on disk.
    const scope = globalThis as { pdfjsWorker?: unknown };
    scope.pdfjsWorker ??=
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return null;
  }
  const task = lib.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (
      let number = 1;
      number <= Math.min(pdf.numPages, MAX_PDF_PAGES);
      number++
    ) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      pages.push(
        items
          .map((item) =>
            "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "",
          )
          .join(""),
      );
    }
    const text = pages.join("\n\n").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    await task.destroy();
  }
}

export async function setAnthropicFileId(
  fileId: string,
  anthropicFileId: string,
): Promise<void> {
  await db.update(file).set({ anthropicFileId }).where(eq(file.id, fileId));
}

/** The single profile row. */
const PROFILE_ID = 1;

/**
 * Stores what Claude read on the upload's row and makes it the profile, with
 * a snapshot, in one transaction. There's no review step: the owner can edit
 * the profile afterwards.
 */
export async function saveParsedProfile(
  fileId: string,
  data: MasterProfile,
): Promise<void> {
  await db.transaction(async (tx) => {
    await keepScoringBaseline(tx);
    await tx
      .update(file)
      .set({ parseStatus: "succeeded", parsedProfile: data, parseError: null })
      .where(eq(file.id, fileId));
    const changes = { data, cvFileId: fileId, updatedAt: new Date() };
    await tx
      .insert(profile)
      .values({ id: PROFILE_ID, ...changes })
      .onConflictDoUpdate({ target: profile.id, set: changes });
    await tx.insert(profileSnapshot).values({ profileData: data });
  });
}

/** Only a read still in progress can fail, so a later step can't undo a saved draft. */
export async function markParseFailed(
  fileId: string,
  message: string,
): Promise<void> {
  await db
    .update(file)
    .set({ parseStatus: "failed", parseError: message })
    .where(and(eq(file.id, fileId), eq(file.parseStatus, "pending")));
}

/**
 * Files API ids of every CV upload other than `keepFileId`. A CV in the Files
 * API is visible to every key in its workspace, so older ones are deleted
 * once a new CV has been read.
 */
export async function getReplacedAnthropicFileIds(
  keepFileId: string,
): Promise<string[]> {
  const rows = await db
    .select({ anthropicFileId: file.anthropicFileId })
    .from(file)
    .where(
      and(
        eq(file.kind, "cv_upload"),
        ne(file.id, keepFileId),
        isNotNull(file.anthropicFileId),
      ),
    );
  return rows.flatMap((row) =>
    row.anthropicFileId ? [row.anthropicFileId] : [],
  );
}

export async function clearAnthropicFileId(
  anthropicFileId: string,
): Promise<void> {
  await db
    .update(file)
    .set({ anthropicFileId: null })
    .where(eq(file.anthropicFileId, anthropicFileId));
}
