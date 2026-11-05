import "server-only";

import { eq, gte, sql } from "drizzle-orm";

import { llmCall } from "@/db/schema";
import { db } from "@/lib/dal/db";

import { readSettings } from "./settings";

// Spend and caps for the budget checks in lib/claude/budget.ts. Claude calls
// run inside Inngest steps with no signed-in user, so this lives here.

export type BudgetLimits = { monthlyUsd: number; runUsd: number };

/**
 * The monthly and per-run caps: from Settings once it's saved, otherwise
 * from MONTHLY_BUDGET_USD and RUN_BUDGET_USD, otherwise $20 and $1.
 */
export async function getBudgetLimits(): Promise<BudgetLimits> {
  const { monthlyBudgetUsd, runBudgetUsd } = await readSettings();
  return { monthlyUsd: monthlyBudgetUsd, runUsd: runBudgetUsd };
}

const totalCost = sql<number>`coalesce(sum(${llmCall.costUsd}), 0)`.mapWith(
  Number,
);

/** What Claude calls have cost since the start of this calendar month (UTC). */
export async function getMonthSpendUsd(now = new Date()): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const [row] = await db
    .select({ total: totalCost })
    .from(llmCall)
    .where(gte(llmCall.createdAt, monthStart));
  return row?.total ?? 0;
}

/** What one run's Claude calls have cost so far. */
export async function getRunSpendUsd(runId: string): Promise<number> {
  const [row] = await db
    .select({ total: totalCost })
    .from(llmCall)
    .where(eq(llmCall.runId, runId));
  return row?.total ?? 0;
}
