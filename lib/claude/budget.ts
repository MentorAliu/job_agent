import "server-only";

import {
  getBudgetLimits,
  getMonthSpendUsd,
  getRunSpendUsd,
  type BudgetLimits,
} from "@/lib/pipeline/budget";

import { costUsd } from "./cost";
import type { StageSetup } from "./llm-call";

/**
 * A paid call that can't be made: it would take spend past the monthly cap
 * or the run's own cap, or there's no API key for it (NoApiKeyError). Either
 * way the step stops with the message, and nothing is retried.
 */
export class BudgetExceededError extends Error {
  constructor(
    readonly scope: "monthly" | "run" | "no_key",
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value > 0 && value < 0.1 ? 3 : 2)}`;
}

export type BudgetState = {
  limits: BudgetLimits;
  monthSpendUsd: number;
  runSpendUsd: number;
  /** What can still be spent: the smaller of the month's and the run's headroom. */
  remainingUsd: number;
  /** Which cap `remainingUsd` comes from. */
  scope: "monthly" | "run";
};

/** The caps and what has been spent against them, for one run or none. */
export async function getBudgetState(runId?: string): Promise<BudgetState> {
  const [limits, monthSpendUsd, runSpendUsd] = await Promise.all([
    getBudgetLimits(),
    getMonthSpendUsd(),
    runId ? getRunSpendUsd(runId) : Promise.resolve(0),
  ]);
  const monthly = limits.monthlyUsd - monthSpendUsd;
  const perRun = runId ? limits.runUsd - runSpendUsd : Infinity;
  return {
    limits,
    monthSpendUsd,
    runSpendUsd,
    remainingUsd: Math.max(0, Math.min(monthly, perRun)),
    scope: perRun < monthly ? "run" : "monthly",
  };
}

/** Why a call can't go ahead, in words the run page shows. */
export function budgetStopMessage(state: BudgetState): string {
  return state.scope === "run"
    ? `Stopped at the ${formatUsd(state.limits.runUsd)} per-run budget set in Settings, after spending ${formatUsd(state.runSpendUsd)}.`
    : `This month's API spend (${formatUsd(state.monthSpendUsd)}) is at the ${formatUsd(state.limits.monthlyUsd)} monthly budget set in Settings.`;
}

/**
 * Why Search now and the daily run can't start a search: the month's budget
 * is spent. Spend is counted per calendar month in UTC.
 */
export function monthlyCapMessage(
  state: Pick<BudgetState, "limits" | "monthSpendUsd">,
  now = new Date(),
): string {
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `This month's API spend (${formatUsd(state.monthSpendUsd)}) is at the ${formatUsd(state.limits.monthlyUsd)} monthly budget, so no new search can start until ${nextMonth}. To search sooner, raise the monthly budget in Settings.`;
}

/**
 * Checks, before a call, that its estimated cost fits under the monthly cap
 * and, for a call in a search run, under the run's cap. Throws
 * BudgetExceededError when it doesn't.
 */
export async function assertWithinBudget(
  estimateUsd: number,
  runId?: string,
): Promise<void> {
  const state = await getBudgetState(runId);
  if (estimateUsd > state.remainingUsd) {
    throw new BudgetExceededError(state.scope, budgetStopMessage(state));
  }
}

/** An upper estimate of one call's cost, from the stage's own prices. */
export function estimateUsd(
  setup: StageSetup,
  usage: {
    inputTokens: number;
    outputTokens: number;
    webSearches?: number;
    batch?: boolean;
  },
): number {
  return costUsd(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 0,
      webSearches: usage.webSearches ?? 0,
      batch: usage.batch ?? false,
    },
    setup.price,
    setup.webSearchPer1k,
  );
}
