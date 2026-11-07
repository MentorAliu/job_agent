import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";

import { event, job, profile, run } from "@/db/schema";
import { scoringKey } from "@/lib/claude/score";
import { db } from "@/lib/dal/db";
import { LOW_SCORE_PASS_PREFIX } from "@/lib/jobs/auto-pick";
import { STALE_DAYS } from "@/lib/jobs/posted";
import {
  pickRolesToRescore,
  profileSearchBlock,
  RESCORE_REASON,
  type RescoreCandidate,
} from "@/lib/jobs/rescore";
import { dayIn } from "@/lib/jobs/today";
import { preferencesSchema, type MasterProfile } from "@/lib/schemas/profile";

import type { Tx } from "./job-writes";
import { createRun, getSearchInputs, type CreateRunResult } from "./runs";
import { readClockSetup, readOwnerTimeZone } from "./setup";

// Scoring again after a change to what scoring reads (lib/jobs/rescore.ts),
// for the save paths, the profile-changed function and the search's
// rescore step. Inngest runs these with no signed-in user.

const PROFILE_ID = 1;

type ProfileRow = {
  data: MasterProfile | null;
  preferences: unknown;
  scoringKey: string | null;
  updatedAt: Date;
};

const profileColumns = {
  data: profile.data,
  preferences: profile.preferences,
  scoringKey: profile.scoringKey,
  updatedAt: profile.updatedAt,
};

/** The scoring key of the saved profile and preferences, or null without both. */
function currentKey(row: ProfileRow): string | null {
  if (!row.data) return null;
  const preferences = preferencesSchema.safeParse(row.preferences);
  return preferences.success ? scoringKey(row.data, preferences.data) : null;
}

/** Records a scoring key without counting as a profile edit. */
async function recordKey(tx: Tx, row: ProfileRow, key: string): Promise<void> {
  await tx
    .update(profile)
    .set({ scoringKey: key, updatedAt: row.updatedAt })
    .where(eq(profile.id, PROFILE_ID));
}

/**
 * Call inside a save's transaction, before it writes the profile or the
 * preferences: when no scoring key is recorded yet, records the one of what
 * is saved now, so the search after the save can tell what changed.
 */
export async function keepScoringBaseline(tx: Tx): Promise<void> {
  const [row] = await tx
    .select(profileColumns)
    .from(profile)
    .where(eq(profile.id, PROFILE_ID))
    .for("update");
  if (!row || row.scoringKey !== null) return;
  const key = currentKey(row);
  if (key) await recordKey(tx, row, key);
}

/** Whether what scoring reads changed since the roles were last scored. */
export async function scoringChanged(): Promise<boolean> {
  const [row] = await db
    .select(profileColumns)
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  if (!row || row.scoringKey === null) return false;
  const key = currentKey(row);
  return key !== null && key !== row.scoringKey;
}

/** Searches profile changes started today, in the owner's time zone. */
async function profileSearchesToday(
  timeZone: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(run)
    .where(
      and(
        eq(run.trigger, "profile"),
        sql`(${run.startedAt} at time zone ${timeZone})::date = ${dayIn(timeZone, now)}::date`,
      ),
    );
  return row?.count ?? 0;
}

export type ProfileSearchStart =
  CreateRunResult | { kind: "off"; reason: string };

/**
 * After the owner saved a profile or preferences change: starts a search,
 * which scores the roles again, unless the change doesn't touch what
 * scoring reads or profileSearchBlock says no. The caller sends the event.
 */
export async function startProfileSearch(
  now = new Date(),
): Promise<ProfileSearchStart> {
  const [setup, inputs, changed] = await Promise.all([
    readClockSetup(),
    getSearchInputs(),
    scoringChanged(),
  ]);
  const reason = profileSearchBlock({
    setupDone: setup.done,
    dailyRunEnabled: inputs.dailyRunEnabled,
    changed,
    searchesToday: await profileSearchesToday(setup.timeZone, now),
  });
  if (reason) return { kind: "off", reason };
  return createRun("profile");
}

/**
 * The roles that may be scored again: scored new roles waiting for a kit,
 * and roles found in the last STALE_DAYS that the app passed over for their
 * score (the last status change says so), which the owner hasn't moved
 * since.
 */
async function rescoreCandidates(
  tx: Tx,
  timeZone: string,
  now: Date,
): Promise<RescoreCandidate[]> {
  const foundSince = new Date(now.getTime() - (STALE_DAYS + 1) * 86_400_000);
  const rows = await tx
    .select({
      id: job.id,
      status: job.status,
      postedOn: job.postedOn,
      foundAt: job.foundAt,
    })
    .from(job)
    .where(
      and(
        isNotNull(job.score),
        isNotNull(job.facts),
        inArray(job.eligibility, ["eligible", "unclear"]),
        or(
          eq(job.status, "new"),
          and(eq(job.status, "skipped"), gt(job.foundAt, foundSince)),
        ),
      ),
    );
  const skipped = rows.filter((row) => row.status === "skipped");
  const lowScore = new Set<string>();
  if (skipped.length > 0) {
    const latest = await tx
      .selectDistinctOn([event.jobId], {
        jobId: event.jobId,
        payload: event.payload,
      })
      .from(event)
      .where(
        and(
          eq(event.type, "status_changed"),
          inArray(
            event.jobId,
            skipped.map((row) => row.id),
          ),
        ),
      )
      .orderBy(event.jobId, desc(event.at));
    for (const { jobId, payload } of latest) {
      const reason =
        payload && "reason" in payload && typeof payload.reason === "string"
          ? payload.reason
          : "";
      if (reason.startsWith(LOW_SCORE_PASS_PREFIX)) lowScore.add(jobId);
    }
  }
  return rows.flatMap((row): RescoreCandidate[] =>
    row.status === "new" || lowScore.has(row.id)
      ? [
          {
            id: row.id,
            status: row.status === "new" ? "new" : "skipped",
            postedOn: row.postedOn,
            foundOn: dayIn(timeZone, row.foundAt),
          },
        ]
      : [],
  );
}

/**
 * The search's rescore step: when what scoring reads changed since the
 * roles were last scored, the roles pickRolesToRescore chooses lose their
 * score, so this search scores them against the new profile, and passed
 * roles go back to New with the reason on their timeline. Auto-pick then
 * decides on them again. The first search with no key recorded only records
 * it.
 */
export async function rescoreIfProfileChanged(
  now = new Date(),
): Promise<{ changed: boolean; rescored: number }> {
  const timeZone = await readOwnerTimeZone();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(profileColumns)
      .from(profile)
      .where(eq(profile.id, PROFILE_ID))
      .for("update");
    const key = row ? currentKey(row) : null;
    if (!row || !key || key === row.scoringKey) {
      return { changed: false, rescored: 0 };
    }
    await recordKey(tx, row, key);
    if (row.scoringKey === null) return { changed: false, rescored: 0 };

    const candidates = await rescoreCandidates(tx, timeZone, now);
    const ids = new Set(pickRolesToRescore(candidates, dayIn(timeZone, now)));
    const waiting = candidates
      .filter((role) => role.status === "new" && ids.has(role.id))
      .map((role) => role.id);
    const passed = candidates
      .filter((role) => role.status === "skipped" && ids.has(role.id))
      .map((role) => role.id);
    const unscored = { score: null, scoreReasons: null, focus: null };

    let rescored = 0;
    if (waiting.length > 0) {
      const updated = await tx
        .update(job)
        .set(unscored)
        .where(and(inArray(job.id, waiting), eq(job.status, "new")))
        .returning({ id: job.id });
      rescored += updated.length;
    }
    if (passed.length > 0) {
      const back = await tx
        .update(job)
        .set({ ...unscored, status: "new" })
        .where(and(inArray(job.id, passed), eq(job.status, "skipped")))
        .returning({ id: job.id });
      if (back.length > 0) {
        await tx.insert(event).values(
          back.map(({ id }) => ({
            jobId: id,
            type: "status_changed",
            payload: {
              from: "skipped" as const,
              to: "new" as const,
              reason: RESCORE_REASON,
            },
          })),
        );
      }
      rescored += back.length;
    }
    return { changed: true, rescored };
  });
}
