import type { GetStepTools } from "inngest";

import { PROFILE_CHANGE_QUIET } from "@/lib/jobs/rescore";
import {
  startProfileSearch,
  type ProfileSearchStart,
} from "@/lib/pipeline/rescore";

import { inngest } from "./client";
import { profileChanged, searchRunRequested } from "./events";

/** How long to wait for a search that's already going, between tries. */
export const ACTIVE_RUN_WAIT = "15m";
/** Tries while a search is going: about 2 hours, then the next search does it. */
export const ACTIVE_RUN_TRIES = 8;

/**
 * A few quiet minutes after the owner last saved the profile, a CV or the
 * job preferences: when what scoring reads changed, starts a search. Its
 * first steps score the waiting and recently passed roles again
 * (lib/pipeline/rescore.ts), then it looks for new roles as every search
 * does. While another search is going, it waits for that one to end, since
 * it may have started before the change. Debounced, so a run of edits
 * starts one search; the search keeps to the budgets like any other.
 */
export const searchAfterProfileChange = inngest.createFunction(
  {
    id: "profile-changed",
    name: "Search again after a profile change",
    triggers: [profileChanged],
    debounce: { period: PROFILE_CHANGE_QUIET, timeout: "30m" },
  },
  ({ step }) => searchAfterChange(step),
);

export type ChangeSteps = Pick<
  GetStepTools<typeof inngest>,
  "run" | "sleep" | "sendEvent"
>;

/** The function's steps: start a search, waiting while one is going. */
export async function searchAfterChange(
  step: ChangeSteps,
): Promise<ProfileSearchStart | { kind: "gave_up" }> {
  for (let attempt = 1; attempt <= ACTIVE_RUN_TRIES; attempt++) {
    const started = await step.run(`start-search-${attempt}`, () =>
      startProfileSearch(),
    );
    if (started.kind === "created") {
      await step.sendEvent(
        "search",
        searchRunRequested.create({ runId: started.runId }),
      );
    }
    if (started.kind !== "active") return started;
    await step.sleep(`wait-for-search-${attempt}`, ACTIVE_RUN_WAIT);
  }
  // The daily search finds the change and scores the roles again then.
  return { kind: "gave_up" };
}
