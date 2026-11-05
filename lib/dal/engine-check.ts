import "server-only";

import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { engineCheck } from "@/db/schema";
import { failEngineCheck } from "@/lib/pipeline/engine-check";
import {
  CHECK_LOST_AFTER_MS,
  ENGINE_CHECK_FAILURES,
  LOST_CHECK_MESSAGE,
  type EngineCheckFailure,
  type EngineCheckView,
} from "@/lib/schemas/setup";
import type { AgentEngine } from "@/lib/schemas/settings";

import { db } from "./db";
import { getCurrentUser } from "./session";

type CheckRow = typeof engineCheck.$inferSelect;

const isFailure = (value: string | null): value is EngineCheckFailure =>
  value !== null && (ENGINE_CHECK_FAILURES as readonly string[]).includes(value);

/**
 * A check as the pages show it. One still queued or running after
 * CHECK_LOST_AFTER_MS reads as failed: the worker stopped, or never picked
 * it up.
 */
export function engineCheckView(
  row: CheckRow,
  now = Date.now(),
): EngineCheckView {
  const lost =
    (row.status === "queued" || row.status === "running") &&
    now - row.createdAt.getTime() > CHECK_LOST_AFTER_MS;
  return {
    id: row.id,
    engine: row.engine,
    status: lost ? "failed" : row.status,
    failure: lost ? "worker" : isFailure(row.failure) ? row.failure : null,
    message: lost ? LOST_CHECK_MESSAGE : row.message,
    model: row.model,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** The engine's latest check, or null when it was never checked. */
export async function getLatestEngineCheck(
  engine: AgentEngine,
): Promise<EngineCheckView | null> {
  await getCurrentUser();
  const [row] = await db
    .select()
    .from(engineCheck)
    .where(eq(engineCheck.engine, engine))
    .orderBy(desc(engineCheck.createdAt))
    .limit(1);
  return row ? engineCheckView(row) : null;
}

/**
 * Saves a check to run on `engine`, or returns the one already waiting or
 * running, so a second click or a second tab doesn't start another. The
 * caller sends the Inngest event for a new one.
 */
export async function requestEngineCheck(
  engine: AgentEngine,
): Promise<{ id: string; created: boolean }> {
  await getCurrentUser();
  const [going] = await db
    .select({ id: engineCheck.id })
    .from(engineCheck)
    .where(
      and(
        eq(engineCheck.engine, engine),
        inArray(engineCheck.status, ["queued", "running"]),
        gte(
          engineCheck.createdAt,
          new Date(Date.now() - CHECK_LOST_AFTER_MS),
        ),
      ),
    )
    .orderBy(desc(engineCheck.createdAt))
    .limit(1);
  if (going) return { id: going.id, created: false };
  const [created] = await db
    .insert(engineCheck)
    .values({ engine })
    .returning({ id: engineCheck.id });
  return { id: created.id, created: true };
}

/** Ends a check whose event couldn't be sent, so it doesn't wait forever. */
export async function markEngineCheckNotSent(
  id: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await failEngineCheck(id, "worker", message);
}
