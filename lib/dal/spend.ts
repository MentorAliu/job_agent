import "server-only";

import {
  count,
  desc,
  gte,
  inArray,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { llmCall, run } from "@/db/schema";
import {
  getBudgetLimits,
  getMonthSpendUsd,
  type BudgetLimits,
} from "@/lib/pipeline/budget";
import {
  STAGE_GROUPS,
  type LlmStage,
  type StageGroup,
} from "@/lib/schemas/settings";

import { db, type Db } from "./db";
import { getCurrentUser } from "./session";

/** What one stage's Claude calls on one model used and cost. */
export type StageCost = {
  stage: LlmStage;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  costUsd: number;
};

type Queryable = Pick<Db, "select">;

const total = (column: AnyColumn) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

/** Tokens and cost by stage and model, for the calls `where` picks. */
export function stageCostQuery(database: Queryable, where: SQL) {
  return database
    .select({
      stage: llmCall.stage,
      model: llmCall.model,
      calls: sql<number>`count(*)`.mapWith(Number),
      inputTokens: total(llmCall.inputTokens),
      outputTokens: total(llmCall.outputTokens),
      cacheReadTokens: total(llmCall.cacheReadInputTokens),
      cacheWriteTokens: total(llmCall.cacheCreationInputTokens),
      webSearches: total(llmCall.webSearches),
      costUsd: total(llmCall.costUsd),
    })
    .from(llmCall)
    .where(where)
    .groupBy(llmCall.stage, llmCall.model)
    .orderBy(desc(sql`sum(${llmCall.costUsd})`));
}

/** The first moment of `now`'s calendar month in UTC, as the budget counts it. */
export function monthStart(now: Date, monthsBack = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1),
  );
}

/** Spend per calendar month (UTC), newest first. */
export function monthlySpendQuery(database: Queryable, since: Date) {
  const month = sql<string>`to_char(date_trunc('month', ${llmCall.createdAt} at time zone 'UTC'), 'YYYY-MM')`;
  return database
    .select({
      month,
      calls: sql<number>`count(*)`.mapWith(Number),
      costUsd: total(llmCall.costUsd),
    })
    .from(llmCall)
    .where(gte(llmCall.createdAt, since))
    .groupBy(month)
    .orderBy(desc(month));
}

/** What each step's calls cost since `since`, whichever model made them. */
export function spendByStageQuery(database: Queryable, since: Date) {
  return database
    .select({ stage: llmCall.stage, costUsd: total(llmCall.costUsd) })
    .from(llmCall)
    .where(gte(llmCall.createdAt, since))
    .groupBy(llmCall.stage);
}

/** What one group of steps cost, among the calls a query reads. */
const groupCost = (group: StageGroup) =>
  sql<number>`coalesce(sum(${llmCall.costUsd}) filter (where ${inArray(
    llmCall.stage,
    [...STAGE_GROUPS[group]],
  )}), 0)`.mapWith(Number);

/** A day's spend on searching, apply kits, CVs, reading replies and provider checks. */
export type DaySpend = { day: string } & Record<StageGroup, number>;

/** Spend per UTC day since `since`, by group of steps, oldest first. */
export function dailySpendQuery(database: Queryable, since: Date) {
  const day = sql<string>`to_char(${llmCall.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  return database
    .select({
      day,
      searching: groupCost("searching"),
      kits: groupCost("kits"),
      cv: groupCost("cv"),
      email: groupCost("email"),
      checks: groupCost("checks"),
    })
    .from(llmCall)
    .where(gte(llmCall.createdAt, since))
    .groupBy(day)
    .orderBy(day);
}

/** Every day of the month that starts at `start`, with what each cost. */
export function monthDays(start: Date, spent: DaySpend[]): DaySpend[] {
  const days = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start.getTime() + index * 864e5)
      .toISOString()
      .slice(0, 10);
    return (
      spent.find((entry) => entry.day === day) ?? {
        day,
        searching: 0,
        kits: 0,
        cv: 0,
        email: 0,
        checks: 0,
      }
    );
  });
}

/** This month's spend by group, and how many apply kits it paid for. */
export function monthCallsQuery(database: Queryable, since: Date) {
  return database
    .select({
      spent: total(llmCall.costUsd),
      searching: groupCost("searching"),
      kits: groupCost("kits"),
      cv: groupCost("cv"),
      email: groupCost("email"),
      checks: groupCost("checks"),
      tailored:
        sql<number>`count(distinct ${llmCall.jobId}) filter (where ${llmCall.stage} = 'tailor')`.mapWith(
          Number,
        ),
    })
    .from(llmCall)
    .where(gte(llmCall.createdAt, since));
}

/** The search runs started since `since`, and how many failed or stopped. */
export function monthRunsQuery(database: Queryable, since: Date) {
  return database
    .select({
      started: count(),
      failed:
        sql<number>`count(*) filter (where ${run.status} = 'failed')`.mapWith(
          Number,
        ),
      stopped:
        sql<number>`count(*) filter (where ${run.status} = 'stopped')`.mapWith(
          Number,
        ),
    })
    .from(run)
    .where(gte(run.startedAt, since));
}

export type MonthActivity = {
  limits: BudgetLimits;
  /** When the budget's month began, and when the next one begins (UTC). */
  monthStart: string;
  nextMonthStart: string;
  spentUsd: number;
  /** What searching, apply kits, CVs, reading replies and provider checks cost this month. */
  costs: Record<StageGroup, number>;
  /** Search runs started this month. */
  searches: { started: number; failed: number; stopped: number };
  /** Roles Claude tailored an apply kit for this month. */
  kits: number;
};

/** This month's spend against the budget, and the searches and kits it paid for. */
export async function getMonthActivity(
  now = new Date(),
): Promise<MonthActivity> {
  await getCurrentUser();
  const start = monthStart(now);
  const [limits, [calls], [runs]] = await Promise.all([
    getBudgetLimits(),
    monthCallsQuery(db, start),
    monthRunsQuery(db, start),
  ]);
  return {
    limits,
    monthStart: start.toISOString(),
    nextMonthStart: monthStart(now, -1).toISOString(),
    spentUsd: calls?.spent ?? 0,
    costs: {
      searching: calls?.searching ?? 0,
      kits: calls?.kits ?? 0,
      cv: calls?.cv ?? 0,
      email: calls?.email ?? 0,
      checks: calls?.checks ?? 0,
    },
    searches: {
      started: runs?.started ?? 0,
      failed: runs?.failed ?? 0,
      stopped: runs?.stopped ?? 0,
    },
    kits: calls?.tailored ?? 0,
  };
}

export type SpendSummary = {
  limits: BudgetLimits;
  /** The first day of this month, as an ISO string. */
  monthStart: string;
  monthSpendUsd: number;
  /** This month's calls by stage, searches and tailoring alike. */
  stages: StageCost[];
  /** Every day of this month, with what it cost so far. */
  days: DaySpend[];
  /** The last six months, newest first. Months with no calls are left out. */
  months: { month: string; calls: number; costUsd: number }[];
};

export async function getSpendSummary(now = new Date()): Promise<SpendSummary> {
  await getCurrentUser();
  const start = monthStart(now);
  const [limits, stages, days, months] = await Promise.all([
    getBudgetLimits(),
    stageCostQuery(db, gte(llmCall.createdAt, start)),
    dailySpendQuery(db, start),
    monthlySpendQuery(db, monthStart(now, 5)),
  ]);
  return {
    limits,
    monthStart: start.toISOString(),
    monthSpendUsd: stages.reduce((sum, stage) => sum + stage.costUsd, 0),
    stages,
    days: monthDays(start, days),
    months,
  };
}

/** This month's spend against the monthly cap, for the sidebar. */
export async function getMonthBudget(
  now = new Date(),
): Promise<{ spentUsd: number; limitUsd: number }> {
  await getCurrentUser();
  const [limits, spentUsd] = await Promise.all([
    getBudgetLimits(),
    getMonthSpendUsd(now),
  ]);
  return { spentUsd, limitUsd: limits.monthlyUsd };
}
