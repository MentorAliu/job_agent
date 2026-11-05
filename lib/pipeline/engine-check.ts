import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { engineCheck } from "@/db/schema";
import { db } from "@/lib/dal/db";
import type { EngineCheckFailure } from "@/lib/schemas/setup";
import type { AgentEngine } from "@/lib/schemas/settings";

// Provider checks, for the Inngest function that runs them (with no
// signed-in user). lib/dal starts them and reads them after checking the
// session.

/** Longer messages are cut, since setup and Settings show them in a line or two. */
const MAX_MESSAGE_CHARS = 500;

/** How a check ended: the model that answered, or why it couldn't. */
export type EngineCheckResult =
  | { ok: true; model: string }
  | { ok: false; failure: EngineCheckFailure; message: string };

/**
 * Marks a queued check as running and returns its engine. Null when the check
 * is gone or already ran, so a repeated event doesn't run it twice.
 */
export async function startEngineCheck(
  id: string,
): Promise<{ engine: AgentEngine; startedAt: Date } | null> {
  const startedAt = new Date();
  const [row] = await db
    .update(engineCheck)
    .set({ status: "running", startedAt })
    .where(and(eq(engineCheck.id, id), eq(engineCheck.status, "queued")))
    .returning({ engine: engineCheck.engine });
  return row ? { engine: row.engine, startedAt } : null;
}

/** Saves how a running check ended. */
export async function finishEngineCheck(
  id: string,
  result: EngineCheckResult,
  durationMs: number,
): Promise<void> {
  await db
    .update(engineCheck)
    .set(
      result.ok
        ? {
            status: "passed",
            model: result.model,
            failure: null,
            message: null,
            durationMs,
            finishedAt: new Date(),
          }
        : {
            status: "failed",
            failure: result.failure,
            message: result.message.slice(0, MAX_MESSAGE_CHARS),
            durationMs,
            finishedAt: new Date(),
          },
    )
    .where(eq(engineCheck.id, id));
}

/**
 * Ends a check that's still queued or running as failed, for when it
 * couldn't run at all, such as an event that couldn't be sent.
 */
export async function failEngineCheck(
  id: string,
  failure: EngineCheckFailure,
  message: string,
): Promise<void> {
  await db
    .update(engineCheck)
    .set({
      status: "failed",
      failure,
      message: message.slice(0, MAX_MESSAGE_CHARS),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(engineCheck.id, id),
        inArray(engineCheck.status, ["queued", "running"]),
      ),
    );
}
