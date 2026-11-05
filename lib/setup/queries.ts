// TanStack Query options for first-run setup and Check it works. The pages
// prefetch them on the server and follow them in the browser while
// something runs: a check, a CV being read, or a CV being written.
import { queryOptions } from "@tanstack/react-query";

import type { SetupState } from "@/lib/dal/setup";
import { FetchError } from "@/lib/jobs/queries";
import { isBuildActive } from "@/lib/schemas/cv-builder";
import type { EngineCheckView } from "@/lib/schemas/setup";
import type { AgentEngine } from "@/lib/schemas/settings";

/** How often setup and Settings check on something that runs. */
export const SETUP_POLL_MS = 2000;

/** Whether a check is still waiting for its answer. */
export function isCheckActive(check: EngineCheckView | null | undefined) {
  return check?.status === "queued" || check?.status === "running";
}

/** Polls while the check, the CV read or the CV build is going, and not otherwise. */
export function setupPollInterval(
  state: SetupState | undefined,
): number | false {
  if (!state) return false;
  const reading = state.cv.upload?.status === "pending";
  const building = state.cv.atsCv ? isBuildActive(state.cv.atsCv) : false;
  return isCheckActive(state.provider.check) || reading || building
    ? SETUP_POLL_MS
    : false;
}

export const setupKey = ["setup"] as const;

export function setupStateQuery() {
  return queryOptions({
    queryKey: setupKey,
    queryFn: async (): Promise<SetupState> => {
      const response = await fetch("/api/setup");
      if (!response.ok) {
        throw new FetchError("Couldn't load setup.", response.status);
      }
      return response.json();
    },
    // Read again when the tab comes back, so two tabs agree, but not right
    // after the server's prefetch.
    staleTime: 5_000,
    refetchInterval: (query) => setupPollInterval(query.state.data),
  });
}

export function engineCheckQuery(engine: AgentEngine) {
  return queryOptions({
    queryKey: ["engine-check", engine] as const,
    queryFn: async (): Promise<EngineCheckView | null> => {
      const response = await fetch(
        `/api/engine-check?engine=${encodeURIComponent(engine)}`,
      );
      if (!response.ok) {
        throw new FetchError("Couldn't load the last check.", response.status);
      }
      const body: { check: EngineCheckView | null } = await response.json();
      return body.check;
    },
    staleTime: 5_000,
    refetchInterval: (query) =>
      isCheckActive(query.state.data) ? SETUP_POLL_MS : false,
  });
}
