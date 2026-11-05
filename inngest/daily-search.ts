import { createRun, getSearchInputs } from "@/lib/pipeline/runs";
import { readClockSetup } from "@/lib/pipeline/setup";

import { inngest } from "./client";
import { MOVED_TIME_ZONE } from "./clock";
import { dailySearchDue, searchRunRequested } from "./events";

/**
 * The daily run at 07:00 in the owner's time zone, scheduled by the morning
 * clock (inngest/clock.ts). It sends nothing before first-run setup is
 * finished, when the owner changed the time zone after it was scheduled,
 * when Settings has the daily run off, or while a run is still going. When
 * the search can't run (no preferences yet, the monthly budget spent), it
 * records a stopped run that says why.
 */
export const dailySearch = inngest.createFunction(
  {
    id: "daily-search",
    name: "Daily job search",
    triggers: [dailySearchDue],
  },
  async ({ event, step }) => {
    const created = await step.run("create-run", async () => {
      const { done, timeZone } = await readClockSetup();
      if (!done) {
        return {
          kind: "off" as const,
          reason: "First-run setup isn't finished yet.",
        };
      }
      if (timeZone !== event.data.timeZone) {
        return { kind: "off" as const, reason: MOVED_TIME_ZONE };
      }
      const { dailyRunEnabled } = await getSearchInputs();
      if (!dailyRunEnabled) {
        return {
          kind: "off" as const,
          reason: "The daily run is off in Settings.",
        };
      }
      return createRun("scheduled");
    });
    if (created.kind === "created") {
      await step.sendEvent(
        "start-search",
        searchRunRequested.create({ runId: created.runId }),
      );
    }
    return created;
  },
);
