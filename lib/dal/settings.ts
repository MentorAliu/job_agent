import "server-only";

import { checkClaudeApiKey } from "@/lib/claude/api-key";
import { cliRunner } from "@/lib/claude/cli/box";
import { checkOpenAiKey } from "@/lib/claude/openai-api";
import { getMonthSpendUsd } from "@/lib/pipeline/budget";
import {
  getEngineStatus,
  removeClaudeApiKey,
  removeCodexLogin,
  removeOpenAiKey,
  replaceClaudeApiKey,
  replaceCodexLogin,
  replaceOpenAiKey,
  type EngineStatus,
} from "@/lib/pipeline/engine-state";
import { readSettings, writeSettings } from "@/lib/pipeline/settings";
import {
  readOwnerTimeZone,
  savableTimeZone,
  writeSetupRow,
} from "@/lib/pipeline/setup";
import type { AgentEngine, SettingsInput } from "@/lib/schemas/settings";

import { getCurrentUser } from "./session";

/** An engine's sign-in and how its last steps went, for Settings and setup. */
export type EngineView = {
  /**
   * Claude Code: CLAUDE_CODE_OAUTH_TOKEN is in the app's environment. Codex:
   * an auth.json is saved. The Claude and OpenAI APIs: an API key is saved,
   * or ANTHROPIC_API_KEY or OPENAI_API_KEY is in the app's environment.
   */
  signedIn: boolean;
  /** The sign-in comes from the app's environment, not from Settings. */
  fromEnv: boolean;
  loginSavedAt: string | null;
  lastOkAt: string | null;
  /** Why the last step that couldn't run on it ran on the Claude API. */
  issue: string | null;
  issueAt: string | null;
};

export type SettingsView = {
  /**
   * What the next run will use: the saved settings, or the defaults. The
   * time zone is the one setup saved, or UTC before it did.
   */
  values: SettingsInput;
  /** False until Settings is first saved. */
  saved: boolean;
  monthSpendUsd: number;
  engines: Record<AgentEngine, EngineView>;
  /** The app has a Claude API key: one saved here, or ANTHROPIC_API_KEY. */
  claudeApiKey: boolean;
  /** Where a plan's command-line agent runs: a Vercel Sandbox, or here. */
  runner: "vercel-sandbox" | "local";
  /**
   * Where a step goes when a plan's agent can't run it: the Claude API when
   * the app has its key, else the OpenAI API when it has that one, else
   * nowhere (lib/claude/send.ts).
   */
  fallback: "claude_api" | "openai_api" | null;
};

function engineView(
  status: EngineStatus,
  signedIn: boolean,
  fromEnv: boolean,
): EngineView {
  return {
    signedIn,
    fromEnv,
    loginSavedAt: status.loginSavedAt?.toISOString() ?? null,
    lastOkAt: status.lastOkAt?.toISOString() ?? null,
    issue: status.issue,
    issueAt: status.issueAt?.toISOString() ?? null,
  };
}

export async function getSettings(): Promise<SettingsView> {
  await getCurrentUser();
  const [
    settings,
    timeZone,
    monthSpendUsd,
    claudeApi,
    claudeCode,
    codex,
    openAi,
  ] = await Promise.all([
    readSettings(),
    readOwnerTimeZone(),
    getMonthSpendUsd(),
    getEngineStatus("claude_api"),
    getEngineStatus("claude_code"),
    getEngineStatus("codex"),
    getEngineStatus("openai_api"),
  ]);
  const openAiFromEnv =
    !openAi.hasLogin && Boolean(process.env.OPENAI_API_KEY?.trim());
  const openAiKey = openAi.hasLogin || openAiFromEnv;
  const claudeFromEnv =
    !claudeApi.hasLogin && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const claudeApiKey = claudeApi.hasLogin || claudeFromEnv;
  return {
    values: {
      dailyRunEnabled: settings.dailyRunEnabled,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      agentEngine: settings.agentEngine,
      timeZone,
    },
    saved: settings.saved,
    monthSpendUsd,
    engines: {
      claude_api: engineView(claudeApi, claudeApiKey, claudeFromEnv),
      claude_code: engineView(
        claudeCode,
        Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()),
        true,
      ),
      codex: engineView(codex, codex.hasLogin, false),
      openai_api: engineView(openAi, openAiKey, openAiFromEnv),
    },
    claudeApiKey,
    runner: cliRunner(),
    fallback: claudeApiKey ? "claude_api" : openAiKey ? "openai_api" : null,
  };
}

/** The owner's time zone, for the pages that show days and hours. */
export async function getOwnerTimeZone(): Promise<string> {
  await getCurrentUser();
  return readOwnerTimeZone();
}

/** Whether the daily search runs, for Runs and spend. */
export async function isDailyRunOn(): Promise<boolean> {
  await getCurrentUser();
  return (await readSettings()).dailyRunEnabled;
}

/**
 * Saves the Settings form. Returns false, saving nothing, when the database
 * doesn't know the time zone.
 */
export async function saveSettings(values: SettingsInput): Promise<boolean> {
  await getCurrentUser();
  const { timeZone, ...row } = values;
  const savable = await savableTimeZone(timeZone);
  if (!savable) return false;
  await writeSettings(row);
  await writeSetupRow({ timeZone: savable });
  return true;
}

/** Keeps the auth.json `codex login` wrote, sealed with the app's secret. */
export async function saveCodexSignIn(authJson: string): Promise<void> {
  await getCurrentUser();
  await replaceCodexLogin(authJson);
}

export async function removeCodexSignIn(): Promise<void> {
  await getCurrentUser();
  await removeCodexLogin();
}

/**
 * Keeps the owner's OpenAI API key, sealed with the app's secret, unless
 * OpenAI says it's wrong. Returns whether it was kept.
 */
export async function saveOpenAiKey(apiKey: string): Promise<boolean> {
  await getCurrentUser();
  if ((await checkOpenAiKey(apiKey)) === "refused") return false;
  await replaceOpenAiKey(apiKey);
  return true;
}

export async function removeOpenAiApiKey(): Promise<void> {
  await getCurrentUser();
  await removeOpenAiKey();
}

/**
 * Keeps the owner's Claude API key, sealed with the app's secret, unless the
 * Claude API says it's wrong. Returns whether it was kept. It takes the place
 * of ANTHROPIC_API_KEY while it's saved.
 */
export async function saveClaudeKey(apiKey: string): Promise<boolean> {
  await getCurrentUser();
  if ((await checkClaudeApiKey(apiKey)) === "refused") return false;
  await replaceClaudeApiKey(apiKey);
  return true;
}

export async function removeClaudeKey(): Promise<void> {
  await getCurrentUser();
  await removeClaudeApiKey();
}
