import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";

import {
  document,
  event,
  file,
  job,
  profile,
  profileSnapshot,
} from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { JobFacts } from "@/lib/schemas/job";
import {
  answersSchema,
  preferencesSchema,
  type Answers,
  type HeaderLink,
  type MasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";
import type {
  ClaimCheck,
  CompanyBrief,
  DocumentContent,
  DocumentKind,
  TailorState,
} from "@/lib/schemas/tailor";
import type { TailoredDocument } from "@/lib/tailor/citations";
import { getStorage } from "@/lib/storage";

// Roles, profiles and documents for the tailoring steps (7–10). Inngest runs
// these with no signed-in user, so they live here rather than in lib/dal.

export type TailorJob = {
  id: string;
  title: string;
  company: string;
  url: string;
  status: typeof job.$inferSelect.status;
  facts: JobFacts | null;
  description: string | null;
  companyBrief: CompanyBrief | null;
  tailoring: TailorState | null;
};

export async function getTailorJob(jobId: string): Promise<TailorJob | null> {
  const [row] = await db
    .select({
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.canonicalUrl,
      status: job.status,
      facts: job.facts,
      description: job.descriptionMd,
      companyBrief: job.companyBrief,
      tailoring: job.tailoring,
    })
    .from(job)
    .where(eq(job.id, jobId));
  return row ?? null;
}

/**
 * Updates the tailoring progress, but only while `requestId` is still the
 * role's latest request. Returns false when a newer request replaced it.
 */
export async function updateTailorState(
  jobId: string,
  requestId: string,
  patch: Partial<Omit<TailorState, "requestId">>,
): Promise<boolean> {
  const updated = await db
    .update(job)
    .set({
      tailoring: sql`${job.tailoring} || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(
      and(
        eq(job.id, jobId),
        sql`${job.tailoring}->>'requestId' = ${requestId}`,
      ),
    )
    .returning({ id: job.id });
  return updated.length > 0;
}

/** Ends a request as failed, with a message the apply kit shows. */
export async function failTailoring(
  jobId: string,
  requestId: string,
  message: string,
): Promise<void> {
  await db
    .update(job)
    .set({
      tailoring: sql`${job.tailoring} || ${JSON.stringify({
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      })}::jsonb`,
    })
    .where(
      and(
        eq(job.id, jobId),
        sql`${job.tailoring}->>'requestId' = ${requestId}`,
        sql`${job.tailoring}->>'status' in ('queued', 'running')`,
      ),
    );
}

export async function saveCompanyBrief(
  jobId: string,
  brief: CompanyBrief,
): Promise<void> {
  await db.update(job).set({ companyBrief: brief }).where(eq(job.id, jobId));
}

export type TailorInputs = {
  /** The frozen profile the documents are written from and checked against. */
  snapshotId: string;
  profile: MasterProfile;
  answers: Answers | null;
  /** For the time zones, which postings often ask about. */
  preferences: Preferences | null;
};

/** The latest saved profile, as its snapshot, and the standard answers. */
export async function getTailorInputs(): Promise<TailorInputs | null> {
  const [[snapshot], [current]] = await Promise.all([
    db
      .select({ id: profileSnapshot.id, data: profileSnapshot.profileData })
      .from(profileSnapshot)
      .orderBy(desc(profileSnapshot.createdAt))
      .limit(1),
    db
      .select({ answers: profile.answers, preferences: profile.preferences })
      .from(profile)
      .where(eq(profile.id, 1)),
  ]);
  if (!snapshot) return null;
  const answers = answersSchema.safeParse(current?.answers);
  const preferences = preferencesSchema.safeParse(current?.preferences);
  return {
    snapshotId: snapshot.id,
    profile: snapshot.data,
    answers: answers.success ? answers.data : null,
    preferences: preferences.success ? preferences.data : null,
  };
}

export async function getSnapshotProfile(
  snapshotId: string,
): Promise<MasterProfile | null> {
  const [row] = await db
    .select({ data: profileSnapshot.profileData })
    .from(profileSnapshot)
    .where(eq(profileSnapshot.id, snapshotId));
  return row?.data ?? null;
}

/** The latest ready version of each kind asked for, to regenerate from. */
export async function getLatestDocuments(
  jobId: string,
  kinds: DocumentKind[],
): Promise<
  {
    kind: DocumentKind;
    content: DocumentContent;
    claimFlags: ClaimCheck | null;
    snapshotId: string;
  }[]
> {
  const rows = await db
    .select({
      kind: document.kind,
      content: document.content,
      claimFlags: document.claimFlags,
      snapshotId: document.snapshotId,
    })
    .from(document)
    .where(
      and(
        eq(document.jobId, jobId),
        inArray(document.kind, kinds),
        isNotNull(document.readyAt),
      ),
    )
    .orderBy(desc(document.version));
  const latest = new Map<DocumentKind, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.kind)) latest.set(row.kind, row);
  return [...latest.values()];
}

export type SavedDocument = { id: string; kind: DocumentKind; version: number };

/**
 * Saves each document as the next version of its kind, with the code check's
 * flags. A retried step finds what its first try saved for the same request
 * and returns that instead of saving it again.
 */
export async function saveDocuments(
  jobId: string,
  requestId: string,
  snapshotId: string,
  note: string | null,
  documents: TailoredDocument[],
): Promise<SavedDocument[]> {
  return db.transaction(async (tx) => {
    // Versions are numbered one at a time per role.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobId}))`);
    const saved: SavedDocument[] = [];
    for (const doc of documents) {
      const [existing] = await tx
        .select({ id: document.id, version: document.version })
        .from(document)
        .where(
          and(eq(document.requestId, requestId), eq(document.kind, doc.kind)),
        );
      if (existing) {
        saved.push({
          id: existing.id,
          kind: doc.kind,
          version: existing.version,
        });
        continue;
      }
      const [latest] = await tx
        .select({ version: max(document.version) })
        .from(document)
        .where(and(eq(document.jobId, jobId), eq(document.kind, doc.kind)));
      const version = (latest?.version ?? 0) + 1;
      const [inserted] = await tx
        .insert(document)
        .values({
          jobId,
          kind: doc.kind,
          version,
          snapshotId,
          content: doc.content,
          claimFlags: { flags: doc.flags, checkedAt: null, checkError: null },
          requestId,
          note,
        })
        .returning({ id: document.id });
      saved.push({ id: inserted.id, kind: doc.kind, version });
    }
    return saved;
  });
}

/** The documents a request saved: an edit the owner saved for its PDF. */
export async function getRequestDocuments(
  requestId: string,
): Promise<SavedDocument[]> {
  return db
    .select({
      id: document.id,
      kind: document.kind,
      version: document.version,
    })
    .from(document)
    .where(eq(document.requestId, requestId));
}

export type StoredDocument = SavedDocument & {
  content: DocumentContent;
  claimFlags: ClaimCheck | null;
  snapshotId: string;
};

export async function getDocuments(ids: string[]): Promise<StoredDocument[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: document.id,
      kind: document.kind,
      version: document.version,
      content: document.content,
      claimFlags: document.claimFlags,
      snapshotId: document.snapshotId,
    })
    .from(document)
    .where(inArray(document.id, ids));
}

export async function setClaimCheck(
  documentId: string,
  check: ClaimCheck,
): Promise<void> {
  await db
    .update(document)
    .set({ claimFlags: check })
    .where(eq(document.id, documentId));
}

/**
 * Stores a document's PDF and links it. Rendering again (a retried step)
 * replaces the same file.
 */
export async function saveDocumentPdf(
  jobId: string,
  documentId: string,
  bytes: Uint8Array,
  headerLinks: HeaderLink[],
): Promise<void> {
  const storageKey = `documents/${jobId}/${documentId}.pdf`;
  await getStorage().put(storageKey, bytes);
  const values = {
    kind: "document_pdf" as const,
    storageKey,
    mime: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(file)
      .values(values)
      .onConflictDoUpdate({ target: file.storageKey, set: values })
      .returning({ id: file.id });
    await tx
      .update(document)
      .set({ pdfFileId: stored.id, headerLinks })
      .where(eq(document.id, documentId));
  });
}

/**
 * Step 10's last write: the documents become the apply kit's latest, a
 * shortlisted role moves to Ready, and both go on the timeline.
 */
export async function finishTailoring(
  jobId: string,
  requestId: string,
  documents: SavedDocument[],
  note: string | null,
  edited = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status })
      .from(job)
      .where(eq(job.id, jobId))
      .for("update");
    if (!current) return;

    const ids = documents.map((doc) => doc.id);
    const fresh = await tx
      .update(document)
      .set({ readyAt: new Date() })
      .where(and(inArray(document.id, ids), sql`${document.readyAt} is null`))
      .returning({ id: document.id });
    // A retried step that already finished writes nothing twice.
    if (fresh.length > 0) {
      await tx.insert(event).values({
        jobId,
        type: "documents_ready",
        payload: {
          documents: documents.map(({ kind, version }) => ({ kind, version })),
          note,
          ...(edited ? { edited } : {}),
        },
      });
    }
    if (current.status === "shortlisted") {
      await tx.update(job).set({ status: "ready" }).where(eq(job.id, jobId));
      await tx.insert(event).values({
        jobId,
        type: "status_changed",
        payload: { from: "shortlisted", to: "ready", reason: null },
      });
    }
    await tx
      .update(job)
      .set({
        tailoring: sql`${job.tailoring} || ${JSON.stringify({
          status: "succeeded",
          stage: "done",
          error: null,
          finishedAt: new Date().toISOString(),
        })}::jsonb`,
      })
      .where(
        and(
          eq(job.id, jobId),
          sql`${job.tailoring}->>'requestId' = ${requestId}`,
        ),
      );
  });
}
