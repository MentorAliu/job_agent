"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { jobCountsQuery } from "@/lib/jobs/queries";

const noSubscription = () => () => {};

/**
 * Kits ready to send, for the nav. The
 * server renders the nav without them, and a part that hydrates late (in a
 * Suspense boundary) may find them already loaded, so they're held back
 * until hydration is over to keep the first render the same as the server's.
 */
export function useJobCounts() {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const { data } = useQuery(jobCountsQuery());
  const counts = hydrated ? data : undefined;
  return {
    readyToSend: counts?.readyToSend ?? 0,
    yourTurn: counts?.yourTurn ?? 0,
  };
}
