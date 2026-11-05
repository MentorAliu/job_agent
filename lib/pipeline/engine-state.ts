import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { engineState } from "@/db/schema";
import { db } from "@/lib/dal/db";
import { open, seal } from "@/lib/secret-box";
import type { AgentEngine, OtherEngine } from "@/lib/schemas/settings";

// The engines' sign-ins and keys, and how the other engines' last step went.
// Inngest steps write it with no signed-in user, so it lives here; lib/dal
// reads it for Settings and setup after checking the session.

const LOGIN_PURPOSE = "codex-login";
const OPENAI_KEY_PURPOSE = "openai-api-key";
const CLAUDE_KEY_PURPOSE = "claude-api-key";
/** Longer messages are cut, since Settings shows them in one line. */
const MAX_ISSUE_CHARS = 300;

export type EngineStatus = {
  engine: AgentEngine;
  hasLogin: boolean;
  loginSavedAt: Date | null;
  lastOkAt: Date | null;
  issue: string | null;
  issueAt: Date | null;
};

async function upsert(
  engine: AgentEngine,
  values: Partial<typeof engineState.$inferInsert>,
): Promise<void> {
  await db
    .insert(engineState)
    .values({ engine, ...values })
    .onConflictDoUpdate({
      target: engineState.engine,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function getEngineStatus(
  engine: AgentEngine,
): Promise<EngineStatus> {
  const [row] = await db
    .select()
    .from(engineState)
    .where(eq(engineState.engine, engine));
  return {
    engine,
    hasLogin: Boolean(row?.login),
    loginSavedAt: row?.loginSavedAt ?? null,
    lastOkAt: row?.lastOkAt ?? null,
    issue: row?.issue ?? null,
    issueAt: row?.issueAt ?? null,
  };
}

async function readLogin(
  engine: AgentEngine,
  purpose: string,
): Promise<string | null> {
  const [row] = await db
    .select({ login: engineState.login })
    .from(engineState)
    .where(eq(engineState.engine, engine));
  return row?.login ? open(row.login, purpose) : null;
}

/** Codex's auth.json as last saved, or null when there's none or it can't be read. */
export function readCodexLogin(): Promise<string | null> {
  return readLogin("codex", LOGIN_PURPOSE);
}

/** Keeps Codex's auth.json, as pasted or as Codex renewed it. */
export async function saveCodexLogin(authJson: string): Promise<void> {
  await upsert("codex", {
    login: seal(authJson, LOGIN_PURPOSE),
    loginSavedAt: new Date(),
  });
}

/** A new auth.json from the owner: what went wrong before no longer applies. */
export async function replaceCodexLogin(authJson: string): Promise<void> {
  await upsert("codex", {
    login: seal(authJson, LOGIN_PURPOSE),
    loginSavedAt: new Date(),
    issue: null,
    issueAt: null,
  });
}

export async function removeCodexLogin(): Promise<void> {
  await upsert("codex", { login: null, loginSavedAt: null });
}

/**
 * The owner's OpenAI API key: the one saved in Settings, else OPENAI_API_KEY
 * from the environment. Null when there's neither.
 */
export async function readOpenAiKey(): Promise<string | null> {
  const saved = await readLogin("openai_api", OPENAI_KEY_PURPOSE);
  return saved ?? (process.env.OPENAI_API_KEY?.trim() || null);
}

/** A new OpenAI API key from the owner: what went wrong before no longer applies. */
export async function replaceOpenAiKey(apiKey: string): Promise<void> {
  await upsert("openai_api", {
    login: seal(apiKey, OPENAI_KEY_PURPOSE),
    loginSavedAt: new Date(),
    issue: null,
    issueAt: null,
  });
}

export async function removeOpenAiKey(): Promise<void> {
  await upsert("openai_api", { login: null, loginSavedAt: null });
}

/** The Claude API key saved in setup or Settings, or null when there's none. */
export function readSavedClaudeApiKey(): Promise<string | null> {
  return readLogin("claude_api", CLAUDE_KEY_PURPOSE);
}

/**
 * The owner's Claude API key: the one saved in setup or Settings, else
 * ANTHROPIC_API_KEY from the environment. Null when there's neither.
 */
export async function readClaudeApiKey(): Promise<string | null> {
  const saved = await readSavedClaudeApiKey();
  return saved ?? (process.env.ANTHROPIC_API_KEY?.trim() || null);
}

/** A new Claude API key from the owner, sealed with the app's secret. */
export async function replaceClaudeApiKey(apiKey: string): Promise<void> {
  await upsert("claude_api", {
    login: seal(apiKey, CLAUDE_KEY_PURPOSE),
    loginSavedAt: new Date(),
    issue: null,
    issueAt: null,
  });
}

export async function removeClaudeApiKey(): Promise<void> {
  await upsert("claude_api", { login: null, loginSavedAt: null });
}

/**
 * A step ran on the engine. The last issue stays, with its time, so Settings
 * still says why an earlier step ran on the API.
 */
export async function noteEngineOk(engine: OtherEngine): Promise<void> {
  await upsert(engine, { lastOkAt: new Date() });
}

/** A step couldn't run on the engine and fell back to the Claude API. */
export async function noteEngineIssue(
  engine: OtherEngine,
  issue: string,
): Promise<void> {
  await upsert(engine, {
    issue: issue.slice(0, MAX_ISSUE_CHARS),
    issueAt: new Date(),
  });
}

/**
 * Takes the engine's sign-in for `ms`, unless another step holds it. OpenAI
 * asks that one auth.json be used by one runner at a time: two renewing it
 * at once would sign both out. Returns the lease's id, or null.
 */
export async function takeLease(
  engine: OtherEngine,
  ms: number,
): Promise<string | null> {
  await db.insert(engineState).values({ engine }).onConflictDoNothing();
  const leaseId = randomUUID();
  const taken = await db
    .update(engineState)
    .set({
      leaseId,
      leaseUntil: sql`now() + ${ms} * interval '1 millisecond'`,
    })
    .where(
      and(
        eq(engineState.engine, engine),
        or(
          isNull(engineState.leaseUntil),
          lt(engineState.leaseUntil, sql`now()`),
        ),
      ),
    )
    .returning({ engine: engineState.engine });
  return taken.length > 0 ? leaseId : null;
}

export async function releaseLease(
  engine: OtherEngine,
  leaseId: string,
): Promise<void> {
  await db
    .update(engineState)
    .set({ leaseId: null, leaseUntil: null })
    .where(
      and(eq(engineState.engine, engine), eq(engineState.leaseId, leaseId)),
    );
}
