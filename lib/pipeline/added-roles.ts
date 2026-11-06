import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { addedRole, event, job, profileSnapshot } from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { JobScore } from "@/lib/schemas/job";
import type { AddedRoleStatus } from "@/lib/schemas/added-role";
import { DOCUMENT_KINDS, newTailorState } from "@/lib/schemas/tailor";

// Roles the owner adds by hand, for the Inngest steps that read them, which
// run with no signed-in user.

/** The reason on a role's timeline when the app makes its kit. */
export const ADDED_ROLE_REASON =
  "You added this role, so its kit is made right away.";

export type AddedRoleRow = {
  id: string;
  url: string;
  text: string;
  status: AddedRoleStatus;
};

export async function getAddedRole(id: string): Promise<AddedRoleRow | null> {
  const [row] = await db
    .select({
      id: addedRole.id,
      url: addedRole.url,
      text: addedRole.text,
      status: addedRole.status,
    })
    .from(addedRole)
    .where(eq(addedRole.id, id));
  return row ?? null;
}

/** Says what came of an added role, and which role it became. */
export async function finishAddedRole(
  id: string,
  status: Exclude<AddedRoleStatus, "reading">,
  note: string,
  jobId: string | null = null,
): Promise<void> {
  await db
    .update(addedRole)
    .set({ status, note, ...(jobId ? { jobId } : {}) })
    .where(eq(addedRole.id, id));
}

/** The role stored under a link's key, or else under a posting's content key. */
export async function findJobId(keys: {
  dedupeKey: string;
  contentKey?: string | null;
}): Promise<string | null> {
  const [byLink] = await db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.dedupeKey, keys.dedupeKey));
  if (byLink) return byLink.id;
  if (!keys.contentKey) return null;
  const [byContent] = await db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.contentKey, keys.contentKey))
    .limit(1);
  return byContent?.id ?? null;
}

export type AddedJob = {
  status: typeof job.$inferSelect.status;
  eligibility: typeof job.$inferSelect.eligibility;
  eligibilityReasons: string[];
  company: string;
  score: number | null;
};

export async function getAddedJob(jobId: string): Promise<AddedJob | null> {
  const [row] = await db
    .select({
      status: job.status,
      eligibility: job.eligibility,
      eligibilityReasons: job.eligibilityReasons,
      company: job.company,
      score: job.score,
    })
    .from(job)
    .where(eq(job.id, jobId));
  return row
    ? { ...row, eligibilityReasons: row.eligibilityReasons ?? [] }
    : null;
}

/** Saves a role's score, unless it already has one (a retried step). */
export async function saveAddedScore(
  jobId: string,
  score: JobScore,
): Promise<void> {
  await db
    .update(job)
    .set({
      score: score.score,
      scoreReasons: { reasons: score.reasons, gaps: score.gaps },
      focus: score.focus,
    })
    .where(and(eq(job.id, jobId), isNull(job.score)));
}

/** Whether a profile was ever saved, which a kit is tailored from. */
export async function hasProfileSnapshot(): Promise<boolean> {
  const rows = await db
    .select({ id: profileSnapshot.id })
    .from(profileSnapshot)
    .limit(1);
  return rows.length > 0;
}

/**
 * Shortlists an added role with a queued tailoring request, if it's still
 * new or was passed over, with the reason on its timeline. Returns the
 * request id, or null when the role has moved on.
 */
export async function shortlistAddedRole(
  jobId: string,
  now = new Date(),
): Promise<string | null> {
  const tailoring = newTailorState(DOCUMENT_KINDS, null, now);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: job.status })
      .from(job)
      .where(and(eq(job.id, jobId), inArray(job.status, ["new", "skipped"])))
      .for("update");
    if (!before) return null;
    await tx
      .update(job)
      .set({ status: "shortlisted", tailoring })
      .where(eq(job.id, jobId));
    await tx.insert(event).values({
      jobId,
      type: "status_changed",
      payload: {
        from: before.status,
        to: "shortlisted",
        reason: ADDED_ROLE_REASON,
      },
    });
    return tailoring.requestId;
  });
}
