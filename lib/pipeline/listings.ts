import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { event, job } from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { EligibilityResult } from "@/lib/jobs/eligibility";
import type { Listing } from "@/lib/jobs/listing-check";
import type { JobFacts } from "@/lib/schemas/job";
import type { JobStatus } from "@/lib/schemas/tracker";

// Roles not sent yet, for the daily check that finds listings the employer
// closed and for the eligibility check each search repeats on them. Both run
// with no signed-in user, so this lives here rather than in lib/dal.

/** Roles not sent yet that the app may still pick or the owner may send. */
export const CHECKED_STATUSES = [
  "new",
  "shortlisted",
  "ready",
] as const satisfies readonly JobStatus[];

/** Roles checked in one day, at most, newest first. */
export const MAX_DAILY_CHECKS = 200;

/** The roles to check, newest first. */
export async function getListingIds(
  limit = MAX_DAILY_CHECKS,
): Promise<string[]> {
  const rows = await db
    .select({ id: job.id })
    .from(job)
    .where(inArray(job.status, [...CHECKED_STATUSES]))
    .orderBy(desc(job.foundAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** The links of these roles, if they still haven't been sent. */
export async function getListings(
  ids: string[],
): Promise<(Listing & { id: string })[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: job.id,
      canonicalUrl: job.canonicalUrl,
      applyUrl: job.applyUrl,
      description: job.descriptionMd,
    })
    .from(job)
    .where(
      and(inArray(job.id, ids), inArray(job.status, [...CHECKED_STATUSES])),
    );
}

/**
 * Moves a role to Listing closed, with the reason on its timeline, if it
 * still hasn't been sent. Returns whether it moved.
 */
export async function closeListing(
  jobId: string,
  reason: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status })
      .from(job)
      .where(and(eq(job.id, jobId), inArray(job.status, [...CHECKED_STATUSES])))
      .for("update");
    if (!current) return false;
    await tx
      .update(job)
      .set({ status: "listing_closed" })
      .where(eq(job.id, jobId));
    await tx.insert(event).values({
      jobId,
      type: "status_changed",
      payload: {
        from: current.status,
        to: "listing_closed",
        reason,
        source: "listing",
      },
    });
    return true;
  });
}

/**
 * Saves the day a role's posting went up, as the daily check read it, for a
 * role that doesn't have one yet: one found before posting dates were read,
 * or whose date couldn't be read then. Returns whether it saved.
 */
export async function savePostedOn(
  jobId: string,
  postedOn: string,
): Promise<boolean> {
  const updated = await db
    .update(job)
    .set({ postedOn })
    .where(and(eq(job.id, jobId), isNull(job.postedOn)))
    .returning({ id: job.id });
  return updated.length > 0;
}

/** A role not sent yet, with what its eligibility check reads. */
export type UnsentRole = {
  id: string;
  facts: JobFacts;
  descriptionMd: string | null;
};

/** Every role not sent yet that has the facts Claude read. */
export async function getUnsentRoles(): Promise<UnsentRole[]> {
  const rows = await db
    .select({
      id: job.id,
      facts: job.facts,
      descriptionMd: job.descriptionMd,
    })
    .from(job)
    .where(
      and(inArray(job.status, [...CHECKED_STATUSES]), isNotNull(job.facts)),
    );
  return rows.flatMap((row) =>
    row.facts ? [{ ...row, facts: row.facts }] : [],
  );
}

/**
 * Moves a role to Not eligible with the new verdict, and its reason on the
 * timeline, if it still hasn't been sent. Returns whether it moved.
 */
export async function markNotEligible(
  jobId: string,
  verdict: EligibilityResult,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status })
      .from(job)
      .where(and(eq(job.id, jobId), inArray(job.status, [...CHECKED_STATUSES])))
      .for("update");
    if (!current) return false;
    await tx
      .update(job)
      .set({
        status: "not_eligible",
        eligibility: "not_eligible",
        eligibilityQuote: verdict.quote || null,
        eligibilityReasons: verdict.reasons,
      })
      .where(eq(job.id, jobId));
    await tx.insert(event).values({
      jobId,
      type: "status_changed",
      payload: {
        from: current.status,
        to: "not_eligible",
        reason: verdict.reasons[0] ?? null,
      },
    });
    return true;
  });
}
