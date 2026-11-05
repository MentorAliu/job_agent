"use server";

import { refresh } from "next/cache";

import { inngest } from "@/inngest/client";
import { searchRunRequested } from "@/inngest/events";
import { markRunFailed, startManualRun } from "@/lib/dal/runs";
import type { SearchBlock } from "@/lib/pipeline/runs";
import {
  formError,
  type ActionFailure,
  type ActionResult,
} from "@/lib/schemas/action";

const START_FAILED_MESSAGE =
  "Couldn't start the search. Check that the Inngest server is running, then try again.";

export type StartSearchResult =
  | ActionResult<{ runId: string }>
  /** The search can't start yet, and why: something to set up, or the budget. */
  | (ActionFailure & { blocked: SearchBlock["cause"] });

/**
 * Search now: records a manual run and sends the event that starts it. When
 * a run is already going, returns that one instead of starting another.
 */
export async function startSearchAction(): Promise<StartSearchResult> {
  const result = await startManualRun();
  if (result.kind === "blocked") {
    return { ...formError(result.reason), blocked: result.cause };
  }

  if (result.kind === "created") {
    try {
      await inngest.send(searchRunRequested.create({ runId: result.runId }));
    } catch (error) {
      console.error("Couldn't send the search event", error);
      await markRunFailed(result.runId, START_FAILED_MESSAGE);
      refresh();
      return formError(START_FAILED_MESSAGE);
    }
  }
  refresh();
  return { ok: true, runId: result.runId };
}
