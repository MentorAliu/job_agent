import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { llmCall, profile, run } from "@/db/schema";
import {
  getBudgetState,
  monthlyCapMessage,
  type BudgetState,
} from "@/lib/claude/budget";
import { discoverEstimateUsd } from "@/lib/claude/discover";
import { getStageSetup } from "@/lib/claude/llm-call";
import { db } from "@/lib/dal/db";
import {
  emptyRunStats,
  type RunCounter,
  type RunStage,
  type RunStats,
  type RunStatus,
} from "@/lib/schemas/job";
import {
  preferencesSchema,
  type MasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";
import { isCliEngine } from "@/lib/schemas/settings";

import { readSettings } from "./settings";

// Search runs, for the Inngest steps and for lib/dal (which checks the
// session first). Inngest steps run with no signed-in user.

export type SearchInputs = {
  profile: MasterProfile | null;
  /** Null until the owner saves job preferences. */
  preferences: Preferences | null;
  domains: string[];
  dailyRunEnabled: boolean;
};

export async function getSearchInputs(): Promise<SearchInputs> {
  const [[profileRow], appSettings] = await Promise.all([
    db
      .select({ data: profile.data, preferences: profile.preferences })
      .from(profile)
      .where(eq(profile.id, 1)),
    readSettings(),
  ]);
  const preferences = preferencesSchema.safeParse(profileRow?.preferences);
  return {
    profile: profileRow?.data ?? null,
    preferences: preferences.success ? preferences.data : null,
    domains: appSettings.searchDomains,
    dailyRunEnabled: appSettings.dailyRunEnabled,
  };
}

/** What the owner still has to do before a search can run. Empty when ready. */
export function searchReadiness(inputs: SearchInputs): string[] {
  const missing: string[] = [];
  if (!inputs.profile) {
    missing.push("Save your profile, so postings can be scored against it.");
  }
  if (!inputs.preferences) {
    missing.push(
      "Save your job preferences, so the search knows where you can work.",
    );
  } else if (inputs.preferences.stack.length === 0) {
    missing.push(
      "Add at least one technology to the stack in your job preferences, so the search knows what to look for.",
    );
  }
  return missing;
}

/**
 * A run still marked running after this long was lost (the Inngest server
 * restarted, say). Scoring waits up to 24 hours for its batch.
 */
const STALE_RUN_MS = 25 * 60 * 60 * 1000;
/** A run the Inngest server hasn't started after this long never will. */
const UNSTARTED_RUN_MS = 15 * 60 * 1000;

export const LOST_RUN_REASON =
  "This search never finished: the Inngest server stopped or couldn't reach the app. Check that it's running, then search again.";

/** A run marked running that Inngest will never finish. */
export function isLostRun(
  row: { status: RunStatus; startedAt: Date; stats: RunStats | null },
  now = Date.now(),
): boolean {
  if (row.status !== "running") return false;
  const age = now - row.startedAt.getTime();
  return (
    age > STALE_RUN_MS ||
    ((row.stats?.stage ?? "queued") === "queued" && age > UNSTARTED_RUN_MS)
  );
}

export type CreateRunResult =
  | { kind: "created"; runId: string }
  /** A run is already going; no second one starts. */
  | { kind: "active"; runId: string }
  /** The search can't run yet. A scheduled run records why as a stopped run. */
  | ({ kind: "blocked"; runId: string | null } & SearchBlock);

/** Why a search can't start: something to save first, or the budget. */
export type SearchBlock = { cause: "setup" | "budget"; reason: string };

/**
 * Why a search can't start, or null when it can: what the owner still has to
 * save, then the monthly budget. A run needs at least one discover call's
 * worth of budget, or it would stop before finding anything.
 */
export function searchBlock(
  missing: string[],
  budget: Pick<BudgetState, "limits" | "monthSpendUsd" | "remainingUsd">,
  minimumUsd: number,
  now = new Date(),
): SearchBlock | null {
  if (missing.length > 0) return { cause: "setup", reason: missing.join(" ") };
  if (budget.remainingUsd < minimumUsd) {
    return { cause: "budget", reason: monthlyCapMessage(budget, now) };
  }
  return null;
}

/** Whether a search could start now, and if not, why. */
export async function checkSearchBlock(): Promise<SearchBlock | null> {
  const [inputs, budget, discover] = await Promise.all([
    getSearchInputs(),
    getBudgetState(),
    getStageSetup("discover"),
  ]);
  // On a command-line agent the searches cost nothing, so no budget is
  // needed. The OpenAI API's stand-ins cost what the Claude models do.
  return searchBlock(
    searchReadiness(inputs),
    budget,
    discover.engine && isCliEngine(discover.engine)
      ? 0
      : discoverEstimateUsd(discover),
  );
}

/**
 * Starts a run unless one is going, the owner hasn't saved what the search
 * needs, or this month's budget is spent. The caller sends the Inngest event.
 */
export async function createRun(
  trigger: "manual" | "scheduled",
): Promise<CreateRunResult> {
  const block = await checkSearchBlock();

  return db.transaction(async (tx) => {
    // One run at a time, even when Search now is clicked twice at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('search-run'))`);
    const running = await tx
      .select({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        stats: run.stats,
      })
      .from(run)
      .where(eq(run.status, "running"));
    // Lost runs end as failed, so they don't block this one.
    for (const lost of running.filter((row) => isLostRun(row))) {
      await endRun(lost.id, "failed", LOST_RUN_REASON, tx);
    }
    const active = running.find((row) => !isLostRun(row));
    if (active) return { kind: "active", runId: active.id };

    if (block) {
      if (trigger === "manual")
        return { kind: "blocked", ...block, runId: null };
      const [stopped] = await tx
        .insert(run)
        .values({
          trigger,
          status: "stopped",
          finishedAt: new Date(),
          stats: { ...emptyRunStats("done"), stopReason: block.reason },
        })
        .returning({ id: run.id });
      return { kind: "blocked", ...block, runId: stopped.id };
    }

    const [created] = await tx
      .insert(run)
      .values({ trigger, status: "running", stats: emptyRunStats("queued") })
      .returning({ id: run.id });
    return { kind: "created", runId: created.id };
  });
}

export async function getRunStatus(
  runId: string,
): Promise<{ status: RunStatus; trigger: "manual" | "scheduled" } | null> {
  const [row] = await db
    .select({ status: run.status, trigger: run.trigger })
    .from(run)
    .where(eq(run.id, runId));
  return row ?? null;
}

/**
 * Adds to a running run's counters, and moves it to `stage` if given. One
 * statement, so parallel steps can't overwrite each other's counts.
 */
export async function updateRunStats(
  runId: string,
  counts: Partial<Record<RunCounter, number>>,
  stage?: RunStage,
): Promise<void> {
  const entries = Object.entries(counts).filter(([, value]) => value !== 0);
  const parts = entries.map(
    ([key, value]) =>
      sql`${key}::text, coalesce((${run.stats} ->> ${key})::int, 0) + ${value}::int`,
  );
  if (stage) parts.push(sql`'stage', ${stage}::text`);
  if (parts.length === 0) return;
  await db
    .update(run)
    .set({
      stats: sql`coalesce(${run.stats}, '{}'::jsonb) || jsonb_build_object(${sql.join(parts, sql`, `)})`,
    })
    .where(and(eq(run.id, runId), eq(run.status, "running")));
}

/**
 * Sets a running run's counters to exact totals, and moves it to `stage` if
 * given. Steps that can be retried end with this, so a retry can't leave a
 * count too high.
 */
export async function setRunCounts(
  runId: string,
  counts: Partial<Record<RunCounter, number>>,
  stage?: RunStage,
): Promise<void> {
  const changes: Partial<RunStats> = { ...counts };
  if (stage) changes.stage = stage;
  await db
    .update(run)
    .set({
      stats: sql`coalesce(${run.stats}, '{}'::jsonb) || ${JSON.stringify(changes)}::jsonb`,
    })
    .where(and(eq(run.id, runId), eq(run.status, "running")));
}

/**
 * Ends a running run: its status, why it stopped, and its cost from
 * `llm_call`. A run that already ended is left as it is.
 */
export async function endRun(
  runId: string,
  status: Exclude<RunStatus, "running">,
  stopReason?: string,
  executor: Pick<typeof db, "update"> = db,
): Promise<void> {
  const changes: Partial<RunStats> = { stage: "done" };
  if (stopReason) changes.stopReason = stopReason;
  await executor
    .update(run)
    .set({
      status,
      finishedAt: new Date(),
      stats: sql`coalesce(${run.stats}, '{}'::jsonb) || ${JSON.stringify(changes)}::jsonb`,
      costUsd: sql`(select coalesce(sum(${llmCall.costUsd}), 0) from ${llmCall} where ${llmCall.runId} = ${runId})`,
    })
    .where(and(eq(run.id, runId), eq(run.status, "running")));
}
