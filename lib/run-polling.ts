import { queryOptions } from "@tanstack/react-query";

import type { RunView } from "@/lib/dal/runs";
import { isRunActive, type RunStatus } from "@/lib/schemas/job";

/** How often the run page and the header check on a run that's going. */
export const RUN_POLL_MS = 2000;

/**
 * TanStack Query's `refetchInterval` for a run: every 2 seconds while it's
 * going, and off once it has ended or couldn't be loaded.
 */
export function runPollInterval(
  run: { status: RunStatus } | undefined,
): number | false {
  return run && isRunActive(run.status) ? RUN_POLL_MS : false;
}

/**
 * One run and the postings it found, polled while it's going. The run page
 * prefetches it; the top bar and Search now follow the run that's going.
 */
export function runQuery(id: string) {
  return queryOptions({
    queryKey: ["run", id] as const,
    queryFn: async (): Promise<RunView> => {
      const response = await fetch(`/api/runs/${id}`);
      if (!response.ok) throw new Error("Couldn't check on the search.");
      return response.json();
    },
    refetchInterval: (query) => runPollInterval(query.state.data),
  });
}
