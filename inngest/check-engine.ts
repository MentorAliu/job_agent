import { checkEngine } from "@/lib/claude/check-engine";
import {
  failEngineCheck,
  finishEngineCheck,
  startEngineCheck,
} from "@/lib/pipeline/engine-check";

import { inngest } from "./client";
import { engineCheckRequested } from "./events";

/**
 * Check it works: one tiny call on the engine the owner picked, with no
 * fallback, so setup and Settings can say whether the agents can run. It
 * isn't retried: the owner sees the failure and tries again.
 */
export const checkEngineFunction = inngest.createFunction(
  {
    id: "check-engine",
    name: "Check provider",
    triggers: [engineCheckRequested],
    retries: 0,
    onFailure: async ({ event, error }) => {
      await failEngineCheck(
        event.data.event.data.checkId,
        "failed",
        `The check couldn't run: ${error.message}`,
      );
    },
  },
  async ({ event, step }) => {
    const { checkId } = event.data;
    return step.run("check", async () => {
      const started = await startEngineCheck(checkId);
      if (!started) return { checkId, ran: false };
      const result = await checkEngine(started.engine);
      await finishEngineCheck(
        checkId,
        result,
        Date.now() - started.startedAt.getTime(),
      );
      return {
        checkId,
        ran: true,
        engine: started.engine,
        passed: result.ok,
        failure: result.ok ? null : result.failure,
      };
    });
  },
);
