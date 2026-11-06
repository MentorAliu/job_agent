import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { event, job, profileSnapshot } from "@/db/schema";
import { getBudgetState } from "@/lib/claude/budget";
import { db } from "@/lib/dal/db";
import {
  kitSlots,
  passedReason,
  pickedReason,
  planAutoPick,
  type Candidate,
} from "@/lib/jobs/auto-pick";
import { focusFromTitle } from "@/lib/jobs/role-focus";
import { dayIn } from "@/lib/jobs/today";
import { ROLE_FOCUS } from "@/lib/schemas/job";
import { isCliEngine } from "@/lib/schemas/settings";
import { DOCUMENT_KINDS, newTailorState } from "@/lib/schemas/tailor";

import { getSearchInputs } from "./runs";
import { readSettings } from "./settings";
import { readOwnerTimeZone } from "./setup";

// After each search, the app sorts the new matches itself (the rules are in
// lib/jobs/auto-pick.ts). Inngest runs this with no signed-in user, so it
// lives here rather than in lib/dal.

export type AutoPickResult = {
  /** Tailoring requests to send, one for each role picked. */
  kits: { jobId: string; requestId: string }[];
  passed: number;
  waiting: number;
};

/**
 * Roles shortlisted so far today, in the owner's time zone, by the app or by
 * hand. Restoring a removed role starts no kit, so it doesn't count.
 */
export async function shortlistedToday(
  timeZone: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(event)
    .where(
      and(
        eq(event.type, "status_changed"),
        sql`${event.payload}->>'to' = 'shortlisted'`,
        sql`${event.payload}->>'from' <> 'removed'`,
        sql`(${event.at} at time zone ${timeZone})::date = ${dayIn(timeZone, now)}::date`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * Sorts every scored new match (see `planAutoPick`) and records it: picked
 * roles are shortlisted with a queued tailoring request, and passed roles
 * are skipped. Each gets a timeline event that gives the reason. With no
 * saved profile there is nothing to tailor from, so nothing is picked.
 */
export async function autoPick(now = new Date()): Promise<AutoPickResult> {
  const timeZone = await readOwnerTimeZone();
  const today = dayIn(timeZone, now);
  const [rows, startedToday, budget, snapshots, settings, inputs] =
    await Promise.all([
      db
        .select({
          id: job.id,
          title: job.title,
          score: job.score,
          focus: job.focus,
          postedOn: job.postedOn,
        })
        .from(job)
        .where(
          and(
            eq(job.status, "new"),
            isNotNull(job.score),
            inArray(job.eligibility, ["eligible", "unclear"]),
            // A role the owner added is theirs to pick; the app never
            // passes it over.
            eq(job.addedByOwner, false),
          ),
        ),
      shortlistedToday(timeZone, now),
      getBudgetState(),
      db.select({ id: profileSnapshot.id }).from(profileSnapshot).limit(1),
      readSettings(),
      getSearchInputs(),
    ]);
  await saveTitleFocus(rows);
  const scored = rows.flatMap((row): Candidate[] =>
    row.score === null
      ? []
      : [
          {
            id: row.id,
            score: row.score,
            focus: row.focus ?? focusFromTitle(row.title),
            postedOn: row.postedOn,
          },
        ],
  );
  // Kits made on a command-line agent cost nothing against the budget.
  const remainingUsd = isCliEngine(settings.agentEngine)
    ? Number.POSITIVE_INFINITY
    : budget.remainingUsd;
  const slots =
    snapshots.length === 0 ? 0 : kitSlots(startedToday, remainingUsd);
  const plan = planAutoPick(
    scored,
    slots,
    inputs.preferences?.roleFocus ?? "any",
    today,
  );

  const kits: AutoPickResult["kits"] = [];
  for (const candidate of plan.pick) {
    const requestId = await shortlist(candidate, now, today);
    if (requestId) kits.push({ jobId: candidate.id, requestId });
  }
  let passed = 0;
  for (const candidate of plan.pass) {
    if (await passOver(candidate, today)) passed++;
  }
  return { kits, passed, waiting: plan.wait.length };
}

/**
 * Roles scored before the score said what they focus on get their title's
 * reading, saved so that Next up lists them in the same order.
 */
async function saveTitleFocus(
  rows: { id: string; title: string; focus: Candidate["focus"] | null }[],
): Promise<void> {
  const unread = rows.filter((row) => row.focus === null);
  for (const focus of ROLE_FOCUS) {
    const ids = unread
      .filter((row) => focusFromTitle(row.title) === focus)
      .map((row) => row.id);
    if (ids.length === 0) continue;
    await db
      .update(job)
      .set({ focus })
      .where(and(inArray(job.id, ids), isNull(job.focus)));
  }
}

/** Moves a role from New to another status with a reason, if it's still new. */
async function decide(
  candidate: Candidate,
  to: "shortlisted" | "skipped",
  reason: string,
  set: Partial<typeof job.$inferInsert> = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(job)
      .set({ status: to, ...set })
      .where(and(eq(job.id, candidate.id), eq(job.status, "new")))
      .returning({ id: job.id });
    if (updated.length === 0) return false;
    await tx.insert(event).values({
      jobId: candidate.id,
      type: "status_changed",
      payload: { from: "new", to, reason },
    });
    return true;
  });
}

/** Shortlists a role with a tailoring request. Returns the request id. */
async function shortlist(
  candidate: Candidate,
  now: Date,
  today: string,
): Promise<string | null> {
  const tailoring = newTailorState(DOCUMENT_KINDS, null, now);
  const done = await decide(
    candidate,
    "shortlisted",
    pickedReason(candidate, today),
    { tailoring },
  );
  return done ? tailoring.requestId : null;
}

function passOver(candidate: Candidate, today: string): Promise<boolean> {
  return decide(candidate, "skipped", passedReason(candidate, today));
}
