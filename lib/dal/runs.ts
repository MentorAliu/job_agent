import "server-only";

import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";

import { job, llmCall, run } from "@/db/schema";
import { getRunSpendUsd } from "@/lib/pipeline/budget";
import {
  checkSearchBlock,
  createRun,
  endRun,
  getSearchInputs,
  isLostRun,
  LOST_RUN_REASON,
  searchReadiness,
  type CreateRunResult,
  type SearchBlock,
} from "@/lib/pipeline/runs";
import {
  emptyRunStats,
  type Eligibility,
  type RunStats,
  type RunStatus,
  type ScoreReasons,
} from "@/lib/schemas/job";

import { db } from "./db";
import { getCurrentUser } from "./session";
import { stageCostQuery, type StageCost } from "./spend";

// Dates are ISO strings, so a run looks the same from a Server Component and
// from GET /api/runs/[id].

export type RunJobView = {
  id: string;
  title: string;
  company: string;
  url: string;
  workplace: string | null;
  eligibility: Eligibility | null;
  eligibilityQuote: string | null;
  eligibilityReasons: string[];
  score: number | null;
  scoreReasons: ScoreReasons | null;
  status: typeof job.$inferSelect.status;
};

export type RunView = {
  id: string;
  trigger: "manual" | "scheduled";
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats;
  /** What the run's Claude calls have cost so far. */
  costUsd: number;
  /** The postings this run found, best score first. */
  jobs: RunJobView[];
  /** What the run's Claude calls used and cost, by stage. */
  stageCosts: StageCost[];
};

export type RunSummary = Pick<
  RunView,
  "id" | "status" | "startedAt" | "finishedAt" | "stats" | "costUsd"
> & {
  /** How many new postings the run stored. */
  saved: number;
};

const summaryColumns = {
  id: run.id,
  trigger: run.trigger,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  stats: run.stats,
};

/** The run with what its Claude calls cost so far and the postings it stored. */
async function toSummary(row: {
  id: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  stats: RunStats | null;
}): Promise<RunSummary> {
  const [costUsd, [stored]] = await Promise.all([
    getRunSpendUsd(row.id),
    db.select({ saved: count() }).from(job).where(eq(job.firstRunId, row.id)),
  ]);
  const stats = { ...emptyRunStats(), ...row.stats };
  // Shown as failed until the next search ends it in the database.
  const lost = isLostRun(row);
  return {
    id: row.id,
    status: lost ? "failed" : row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    stats: lost
      ? { ...stats, stage: "done", stopReason: LOST_RUN_REASON }
      : stats,
    costUsd,
    saved: stored?.saved ?? 0,
  };
}

export async function getRun(id: string): Promise<RunView | null> {
  await getCurrentUser();
  const [row] = await db.select(summaryColumns).from(run).where(eq(run.id, id));
  if (!row) return null;

  const jobsQuery = db
    .select({
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.canonicalUrl,
      workplace: sql<string | null>`${job.facts} -> 'location' ->> 'workplace'`,
      eligibility: job.eligibility,
      eligibilityQuote: job.eligibilityQuote,
      eligibilityReasons: job.eligibilityReasons,
      score: job.score,
      scoreReasons: job.scoreReasons,
      status: job.status,
    })
    .from(job)
    .where(eq(job.firstRunId, id))
    .orderBy(sql`${job.score} desc nulls last`, asc(job.foundAt));
  const [jobs, stageCosts, summary] = await Promise.all([
    jobsQuery,
    stageCostQuery(db, eq(llmCall.runId, id)),
    toSummary(row),
  ]);

  return {
    ...summary,
    trigger: row.trigger,
    stageCosts,
    jobs: jobs.map((entry) => ({
      ...entry,
      eligibilityReasons: entry.eligibilityReasons ?? [],
    })),
  };
}

export type RunListItem = RunSummary & {
  trigger: "manual" | "scheduled";
  /** Postings the run stored that have a score. */
  scored: number;
};

export type RunPage = {
  runs: RunListItem[];
  /** 1-based. */
  page: number;
  pageCount: number;
  perPage: number;
  total: number;
};

export const RUNS_PER_PAGE = 10;

/** Every run, newest first, a page at a time, for the run history. */
export async function listRuns(page: number): Promise<RunPage> {
  await getCurrentUser();
  const [[counted], rows] = await Promise.all([
    db.select({ total: count() }).from(run),
    db
      .select(summaryColumns)
      .from(run)
      .orderBy(desc(run.startedAt))
      .limit(RUNS_PER_PAGE)
      .offset((page - 1) * RUNS_PER_PAGE),
  ]);
  const ids = rows.map((row) => row.id);
  const [found, costs] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              runId: job.firstRunId,
              saved: count(),
              scored: count(job.score),
            })
            .from(job)
            .where(inArray(job.firstRunId, ids))
            .groupBy(job.firstRunId),
          db
            .select({
              runId: llmCall.runId,
              costUsd:
                sql<number>`coalesce(sum(${llmCall.costUsd}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(llmCall)
            .where(inArray(llmCall.runId, ids))
            .groupBy(llmCall.runId),
        ]);
  const total = counted?.total ?? 0;
  return {
    runs: rows.map((row) => {
      const jobs = found.find((entry) => entry.runId === row.id);
      const lost = isLostRun(row);
      const stats = { ...emptyRunStats(), ...row.stats };
      return {
        id: row.id,
        trigger: row.trigger,
        status: lost ? "failed" : row.status,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        stats: lost
          ? { ...stats, stage: "done", stopReason: LOST_RUN_REASON }
          : stats,
        costUsd: costs.find((entry) => entry.runId === row.id)?.costUsd ?? 0,
        saved: jobs?.saved ?? 0,
        scored: jobs?.scored ?? 0,
      };
    }),
    page,
    pageCount: Math.max(1, Math.ceil(total / RUNS_PER_PAGE)),
    perPage: RUNS_PER_PAGE,
    total,
  };
}

/**
 * The most recent run, for the top bar, the sidebar and the home page. Read
 * once per request, however many of them render.
 */
export const getLatestRun = cache(async (): Promise<RunSummary | null> => {
  await getCurrentUser();
  const [row] = await db
    .select(summaryColumns)
    .from(run)
    .orderBy(desc(run.startedAt))
    .limit(1);
  return row ? await toSummary(row) : null;
});

/** What the owner still has to do before searching. Empty when ready. */
export async function getSearchReadiness(): Promise<string[]> {
  await getCurrentUser();
  return searchReadiness(await getSearchInputs());
}

/** Why a search can't start now, or null when it can. */
export async function getSearchBlock(): Promise<SearchBlock | null> {
  await getCurrentUser();
  return checkSearchBlock();
}

/** Search now: starts a manual run, unless one is already going. */
export async function startManualRun(): Promise<CreateRunResult> {
  await getCurrentUser();
  return createRun("manual");
}

/** For when a run's Inngest event couldn't be sent. */
export async function markRunFailed(
  runId: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await endRun(runId, "failed", message);
}
