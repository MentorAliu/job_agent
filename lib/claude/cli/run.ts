import "server-only";

import {
  noteEngineIssue,
  noteEngineOk,
  readCodexLogin,
  releaseLease,
  saveCodexLogin,
  takeLease,
} from "@/lib/pipeline/engine-state";
import type { CliEngine, OtherEngine } from "@/lib/schemas/settings";

import { runClaudeCode } from "./claude-code";
import { runCodex } from "./codex";
import { BOX_TIMEOUT_MS, withCliBox } from "./box";
import { CliEngineError, type CliReply, type CliTask } from "./task";

export type CliOutcome =
  { ok: true; reply: CliReply } | { ok: false; error: CliEngineError };

/** How long a step waits for another to finish with Codex's sign-in. */
const LEASE_WAIT_MS = 45_000;
const LEASE_POLL_MS = 2_000;

/**
 * Any error under a running agent as a CliEngineError, so the step falls
 * back to the API. Anything but the agent's own failure, such as a lost
 * connection to the sandbox, counts as the box failing.
 */
function asCliError(engine: CliEngine, error: unknown): CliEngineError {
  if (error instanceof CliEngineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliEngineError(
    engine,
    "sandbox",
    `The agent's box failed: ${message}`,
  );
}

/** The engine's sign-in, or a CliEngineError saying how to set it up. */
async function signIn(engine: CliEngine): Promise<string> {
  if (engine === "claude_code") {
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (token) return token;
    throw new CliEngineError(
      engine,
      "setup",
      "Claude Code isn't signed in: CLAUDE_CODE_OAUTH_TOKEN isn't in the app's environment.",
    );
  }
  const login = await readCodexLogin();
  if (login) return login;
  throw new CliEngineError(
    engine,
    "setup",
    "Codex isn't signed in: paste its auth.json in Settings.",
  );
}

/**
 * Codex's sign-in for this step alone, waiting for another step to finish
 * with it. Claude Code's token can be used by many steps at once.
 */
async function waitForLease(
  engine: CliEngine,
  started: number,
): Promise<string | null> {
  if (engine !== "codex") return null;
  for (;;) {
    const lease = await takeLease(engine, BOX_TIMEOUT_MS + 30_000);
    if (lease) return lease;
    if (Date.now() - started > LEASE_WAIT_MS) {
      throw new CliEngineError(
        engine,
        "busy",
        "Codex was busy with another step for too long.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
  }
}

/**
 * Runs tasks one after another in one box, so a step with several, such
 * as scoring a few postings, starts only one. A task that fails leaves the
 * others to run, unless its failure would stop them too, such as a reached
 * usage limit. Records how the engine did, for Settings.
 */
export async function runCliTasks(
  engine: CliEngine,
  tasks: CliTask[],
): Promise<CliOutcome[]> {
  if (tasks.length === 0) return [];
  const started = Date.now();
  let outcomes: CliOutcome[];
  let lease: string | null = null;
  try {
    lease = await waitForLease(engine, started);
    // Read after the lease, so it's the copy the last step renewed.
    const credential = await signIn(engine);
    outcomes = await withCliBox(
      engine,
      async (box) => {
        const done: CliOutcome[] = [];
        let login = credential;
        for (const task of tasks) {
          const stopped = done.findLast((outcome) => !outcome.ok);
          if (stopped && !stopped.ok && stopped.error.stopsTheRest) {
            done.push(stopped);
            continue;
          }
          try {
            const reply =
              engine === "claude_code"
                ? await runClaudeCode(box, task, login)
                : await runCodex(box, task, login, async (renewed) => {
                    login = renewed;
                    await saveCodexLogin(renewed);
                  });
            done.push({ ok: true, reply });
          } catch (error) {
            // The answers so far are kept when the box fails under one.
            done.push({ ok: false, error: asCliError(engine, error) });
          }
        }
        return done;
      },
      BOX_TIMEOUT_MS - (Date.now() - started),
    );
  } catch (error) {
    const failure = asCliError(engine, error);
    outcomes = tasks.map(() => ({ ok: false, error: failure }));
  } finally {
    // A lease left behind runs out by itself.
    if (lease) await releaseLease(engine, lease).catch(() => {});
  }

  await noteOutcomes(engine, outcomes);
  return outcomes;
}

/**
 * Records how the engine did, for Settings: when it last answered, and why
 * the last step it couldn't answer ran on the API. A call held back by the
 * budget isn't the engine's issue.
 */
export async function noteOutcomes(
  engine: OtherEngine,
  outcomes: CliOutcome[],
): Promise<void> {
  if (outcomes.some((outcome) => outcome.ok)) await noteEngineOk(engine);
  const failed = outcomes.findLast((outcome) => !outcome.ok);
  if (failed && !failed.ok && failed.error.failure !== "budget") {
    await noteEngineIssue(engine, failed.error.message);
  }
}
