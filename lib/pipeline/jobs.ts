import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { job, llmCall, seenLink } from "@/db/schema";
import type { JobToScore } from "@/lib/claude/score";
import { db } from "@/lib/dal/db";
import type { PostingLink } from "@/lib/jobs/canonical-url";
import type { JobScore } from "@/lib/schemas/job";

// Postings, for the Inngest steps of a search run.

/** The links no run has read yet. */
export async function unseenLinks<T extends PostingLink>(
  links: T[],
): Promise<T[]> {
  if (links.length === 0) return [];
  const keys = links.map((link) => link.dedupeKey);
  const [stored, skipped] = await Promise.all([
    db
      .select({ key: job.dedupeKey })
      .from(job)
      .where(inArray(job.dedupeKey, keys)),
    db
      .select({ key: seenLink.dedupeKey })
      .from(seenLink)
      .where(
        and(inArray(seenLink.dedupeKey, keys), eq(seenLink.tryAgain, false)),
      ),
  ]);
  const seen = new Set([...stored, ...skipped].map((row) => row.key));
  return links.filter((link) => !seen.has(link.dedupeKey));
}

/**
 * Remembers a link that was read but not stored, so it isn't read again.
 * With `mayPass`, the read failed in a way that may pass next time: the
 * next run tries once more, and a failure in a later run ends the tries. A
 * retried step in the same run keeps the next run's try.
 */
export async function recordSeenLink(
  link: PostingLink,
  reason: string,
  runId: string,
  { mayPass = false }: { mayPass?: boolean } = {},
): Promise<void> {
  await db
    .insert(seenLink)
    .values({
      dedupeKey: link.dedupeKey,
      url: link.canonicalUrl,
      reason,
      tryAgain: mayPass,
      firstRunId: runId,
    })
    .onConflictDoUpdate({
      target: seenLink.dedupeKey,
      set: {
        reason,
        tryAgain: mayPass
          ? sql`coalesce(${seenLink.firstRunId} = ${runId}, false)`
          : false,
      },
    });
}

/**
 * Stores a new posting. A posting already stored under the same dedupe key,
 * or under the same content key at another link, isn't stored again. A
 * retried step finds the row its first try stored, and still gets "saved".
 */
export async function insertJob(
  values: typeof job.$inferInsert,
): Promise<"saved" | "duplicate"> {
  const outcome = (existing: {
    dedupeKey: string;
    firstRunId: string | null;
  }) =>
    existing.dedupeKey === values.dedupeKey &&
    existing.firstRunId === (values.firstRunId ?? null)
      ? "saved"
      : "duplicate";
  const existingColumns = {
    dedupeKey: job.dedupeKey,
    firstRunId: job.firstRunId,
  };

  return db.transaction(async (tx) => {
    if (values.contentKey) {
      // Parallel steps can read the same posting from two sites at once.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${values.contentKey}))`,
      );
      const [existing] = await tx
        .select(existingColumns)
        .from(job)
        .where(eq(job.contentKey, values.contentKey))
        .limit(1);
      if (existing) return outcome(existing);
    }
    const inserted = await tx
      .insert(job)
      .values(values)
      .onConflictDoNothing({ target: job.dedupeKey })
      .returning({ id: job.id });
    if (inserted.length > 0) return "saved";
    const [existing] = await tx
      .select(existingColumns)
      .from(job)
      .where(eq(job.dedupeKey, values.dedupeKey));
    return existing ? outcome(existing) : "duplicate";
  });
}

/**
 * New, eligible or unclear postings without a score, oldest first, or only
 * those of `ids`. That includes any an earlier run saved but couldn't score.
 */
export async function getJobsToScore(
  limit: number,
  ids?: string[],
): Promise<JobToScore[]> {
  const rows = await db
    .select({
      id: job.id,
      title: job.title,
      company: job.company,
      facts: job.facts,
      eligibility: job.eligibility,
      eligibilityReasons: job.eligibilityReasons,
    })
    .from(job)
    .where(
      and(
        isNull(job.score),
        eq(job.status, "new"),
        inArray(job.eligibility, ["eligible", "unclear"]),
        isNotNull(job.facts),
        ids ? inArray(job.id, ids) : undefined,
      ),
    )
    .orderBy(asc(job.foundAt))
    .limit(limit);
  return rows.flatMap((row) =>
    row.facts && row.eligibility
      ? [
          {
            id: row.id,
            title: row.title,
            company: row.company,
            facts: row.facts,
            eligibility: row.eligibility,
            eligibilityReasons: row.eligibilityReasons ?? [],
          },
        ]
      : [],
  );
}

type LlmCallRow = typeof llmCall.$inferInsert;

/**
 * Saves a score and logs its call, in one transaction. A posting that already
 * has a score (a retried step) is left alone and its call isn't logged twice.
 */
export async function saveScore(
  jobId: string,
  score: JobScore,
  call: LlmCallRow,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(job)
      .set({
        score: score.score,
        scoreReasons: { reasons: score.reasons, gaps: score.gaps },
        focus: score.focus,
      })
      .where(and(eq(job.id, jobId), isNull(job.score)))
      .returning({ id: job.id });
    if (updated.length === 0) return false;
    await tx.insert(llmCall).values(call);
    return true;
  });
}

/** Logs a batch result that has no score, once per request id. */
export async function recordBatchCall(call: LlmCallRow): Promise<void> {
  await db.transaction(async (tx) => {
    if (call.requestId) {
      const [existing] = await tx
        .select({ id: llmCall.id })
        .from(llmCall)
        .where(eq(llmCall.requestId, call.requestId))
        .limit(1);
      if (existing) return;
    }
    await tx.insert(llmCall).values(call);
  });
}
