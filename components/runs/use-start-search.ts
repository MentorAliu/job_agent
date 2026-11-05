"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { startSearchAction } from "@/app/(app)/runs/actions";
import { callAction } from "@/lib/call-action";
import { topBarQuery } from "@/lib/jobs/queries";
import type { SearchBlock } from "@/lib/pipeline/runs";

export type StartSearchError = {
  title: string;
  message: string;
  /** Set when the search can't start yet: something to set up, or the budget. */
  blocked?: SearchBlock["cause"];
};

const ERROR_TITLES: Record<SearchBlock["cause"] | "failed", string> = {
  budget: "Monthly budget reached",
  setup: "Not ready to search yet",
  failed: "Couldn't start the search",
};

/**
 * Search now, for the Runs page's button: starts a run and
 * opens its page, or hands `onError` the reason it couldn't start.
 */
export function useStartSearch(onError: (error: StartSearchError) => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await callAction(() => startSearchAction());
      if (!result.ok) {
        const blocked = "blocked" in result ? result.blocked : undefined;
        onError({
          title: ERROR_TITLES[blocked ?? "failed"],
          message: result.errors.formErrors[0] ?? "Couldn't start the search.",
          blocked,
        });
        return;
      }
      // The top bar follows the run from here.
      void queryClient.invalidateQueries({ queryKey: topBarQuery().queryKey });
      router.push(`/runs/${result.runId}`);
    });
  }

  return { pending, start };
}
