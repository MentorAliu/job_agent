import "server-only";

import { eq } from "drizzle-orm";

import { settings } from "@/db/schema";
import { db } from "@/lib/dal/db";
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_SEARCH_DOMAINS,
  DEFAULT_STAGE_MODELS,
  isAgentEngine,
  priceTableSchema,
  type AgentEngine,
  type PriceTable,
  type SettingsRowInput,
  type StageModels,
} from "@/lib/schemas/settings";

// The one `settings` row, for the Inngest steps and for lib/dal (which checks
// the session first). Every step reads it when it runs, so a change made in
// Settings applies from the next run on. Only the daily search, the monthly
// budget and what the agents run on come from the row; the rest is fixed in
// code.

export type AppSettings = {
  dailyRunEnabled: boolean;
  searchDomains: string[];
  monthlyBudgetUsd: number;
  runBudgetUsd: number;
  models: StageModels;
  prices: PriceTable;
  /** What the agent steps run on. A command-line engine falls back to the API. */
  agentEngine: AgentEngine;
  /** False until Settings is first saved: the monthly cap comes from .env until then. */
  saved: boolean;
};

export const DEFAULT_BUDGETS = { monthlyBudgetUsd: 20, runBudgetUsd: 1 };

type SettingsRow = Pick<
  typeof settings.$inferSelect,
  "dailyRunEnabled" | "monthlyBudgetUsd" | "prices" | "agentEngine"
>;

function usdFromEnv(
  env: Record<string, string | undefined>,
  name: string,
): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * What the agents run on until Settings is saved: AGENT_ENGINE, which setup
 * writes to .env, else the first engine the environment has a sign-in for,
 * a plan's command-line agent before an API. With none, Claude Code, so
 * Settings opens on the plan sign-in.
 */
export function defaultEngine(
  env: Record<string, string | undefined> = process.env,
): AgentEngine {
  const named = env.AGENT_ENGINE?.trim() ?? "";
  if (isAgentEngine(named)) return named;
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return "claude_code";
  if (env.ANTHROPIC_API_KEY?.trim()) return "claude_api";
  if (env.OPENAI_API_KEY?.trim()) return "openai_api";
  return "claude_code";
}

/**
 * The settings row with the defaults filled in. Before the row exists, the
 * monthly cap comes from MONTHLY_BUDGET_USD, otherwise $20. The per-run cap
 * comes from RUN_BUDGET_USD, otherwise $1. The models and search domains are
 * the defaults in lib/schemas/settings.ts, and the engine is defaultEngine's
 * until Settings is saved. Columns from older versions of
 * Settings (domains, models, the per-run cap) are no longer read.
 */
export function resolveSettings(
  row: SettingsRow | null,
  env: Record<string, string | undefined> = process.env,
): AppSettings {
  const prices = priceTableSchema.safeParse(row?.prices ?? DEFAULT_PRICE_TABLE);
  return {
    dailyRunEnabled: row?.dailyRunEnabled ?? true,
    searchDomains: DEFAULT_SEARCH_DOMAINS,
    monthlyBudgetUsd:
      row?.monthlyBudgetUsd ??
      usdFromEnv(env, "MONTHLY_BUDGET_USD") ??
      DEFAULT_BUDGETS.monthlyBudgetUsd,
    runBudgetUsd:
      usdFromEnv(env, "RUN_BUDGET_USD") ?? DEFAULT_BUDGETS.runBudgetUsd,
    models: DEFAULT_STAGE_MODELS,
    prices: prices.success ? prices.data : DEFAULT_PRICE_TABLE,
    agentEngine: row?.agentEngine ?? defaultEngine(env),
    saved: row !== null,
  };
}

export async function readSettings(): Promise<AppSettings> {
  const [row] = await db
    .select({
      dailyRunEnabled: settings.dailyRunEnabled,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      prices: settings.prices,
      agentEngine: settings.agentEngine,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  return resolveSettings(row ?? null);
}

/** Saves the Settings form. The other columns are left as they are. */
export async function writeSettings(values: SettingsRowInput): Promise<void> {
  await db
    .insert(settings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...values, updatedAt: new Date() },
    });
}
