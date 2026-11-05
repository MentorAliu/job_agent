// The three ticks under Check it works, from the latest check: the sign-in
// or key is there, the background worker picked the check up, and the
// engine answered. Kept apart from the panel so it's tested on its own.
import { isCheckActive } from "@/lib/setup/queries";
import type { EngineCheckView } from "@/lib/schemas/setup";
import { ENGINE_NAMES, type AgentEngine } from "@/lib/schemas/settings";

export type TickState = "done" | "running" | "failed" | "waiting";

/**
 * The check's three parts: the sign-in or key is there, the background
 * worker picked the check up, and the engine answered.
 */
export function checkTicks({
  engine,
  check,
  ready,
  pending,
  stale,
}: {
  engine: AgentEngine;
  check: EngineCheckView | null;
  ready: boolean;
  pending: boolean;
  stale: boolean;
}): { label: string; state: TickState }[] {
  const isKey = engine === "claude_api" || engine === "openai_api";
  const status = pending && !isCheckActive(check) ? "queued" : check?.status;
  const failure = status === "failed" ? check?.failure : null;
  const signedIn: TickState =
    failure === "setup" || failure === "login" || !ready ? "failed" : "done";
  const worker: TickState =
    status === undefined
      ? "waiting"
      : status === "queued"
        ? "running"
        : failure === "worker"
          ? "failed"
          : "done";
  const answer: TickState =
    status === "passed" && !stale
      ? "done"
      : status === "running"
        ? "running"
        : status === "failed" && failure !== "worker"
          ? "failed"
          : "waiting";
  const seconds =
    status === "passed" && check?.durationMs != null
      ? Math.max(1, Math.round(check.durationMs / 1000))
      : null;
  return [
    {
      label: isKey ? "Key found" : `${ENGINE_NAMES[engine]} signed in`,
      state: signedIn,
    },
    { label: "Background worker picked the check up", state: worker },
    {
      label:
        seconds !== null
          ? `${ENGINE_NAMES[engine]} answered in ${seconds} s`
          : `${ENGINE_NAMES[engine]} answered`,
      state: answer,
    },
  ];
}
