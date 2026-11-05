"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RadarIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RunSummary } from "@/lib/dal/runs";
import { jobsKey } from "@/lib/jobs/queries";
import { runPollInterval, runQuery } from "@/lib/run-polling";
import { isRunActive } from "@/lib/schemas/job";

import { progressLine } from "./run-labels";
import { useStartSearch, type StartSearchError } from "./use-start-search";

/**
 * The Runs page's Search now button. While a run is going it shows the run's
 * progress instead, polling until the run ends. On a phone both shrink to
 * an icon and keep their text for screen readers.
 */
export function SearchNow({ latest }: { latest: RunSummary | null }) {
  const [error, setError] = useState<StartSearchError | null>(null);
  const { pending, start } = useStartSearch(setError);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  function dismiss() {
    setError(null);
    buttonRef.current?.focus();
  }

  const active = latest && isRunActive(latest.status) ? latest : null;
  const { data: run } = useQuery({
    ...runQuery(active?.id ?? ""),
    enabled: active !== null,
    refetchInterval: (query) =>
      runPollInterval(query.state.data ?? active ?? undefined),
  });
  const current = run ?? active;
  const ended =
    active !== null && run !== undefined && !isRunActive(run.status);

  // Once the search ends, the sidebar's run card and the nav's counts are
  // out of date. The refresh renders this again with the ended run.
  useEffect(() => {
    if (!ended) return;
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: jobsKey });
  }, [ended, router, queryClient]);

  if (current && isRunActive(current.status)) {
    return (
      <Link
        href={`/runs/${current.id}`}
        className="inline-flex h-8 max-w-72 min-w-8 items-center justify-center gap-2 rounded-lg bg-primary-soft px-2.5 text-sm font-medium text-primary-ink outline-none hover:bg-primary-soft/70 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Spinner aria-hidden className="shrink-0" />
        <span className="truncate max-sm:sr-only">
          <span className="sr-only">Search running: </span>
          {progressLine(current)}
        </span>
      </Link>
    );
  }

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && error) dismiss();
      }}
    >
      <Button
        ref={buttonRef}
        disabled={pending}
        aria-describedby={error ? "search-now-error" : undefined}
        className="max-sm:w-8 max-sm:bg-primary-soft max-sm:px-0 max-sm:text-primary-ink"
        onClick={() => {
          setError(null);
          start();
        }}
      >
        {pending ? (
          <Spinner aria-hidden data-icon="inline-start" />
        ) : (
          <RadarIcon aria-hidden data-icon="inline-start" />
        )}
        <span className="max-sm:sr-only">Search now</span>
      </Button>
      {error ? (
        <div
          id="search-now-error"
          role="alert"
          className="absolute top-full right-0 z-50 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <p className="font-medium">{error.title}</p>
          <p className="text-muted-foreground">{error.message}</p>
          <div className="flex items-center justify-end gap-3">
            {error.blocked === "budget" ? (
              <Link
                href="/settings"
                onClick={() => setError(null)}
                className="underline underline-offset-4"
              >
                Open Settings
              </Link>
            ) : error.blocked === "setup" ? (
              <Link
                href="/"
                onClick={() => setError(null)}
                className="underline underline-offset-4"
              >
                See what to set up
              </Link>
            ) : null}
            <Button size="sm" variant="outline" onClick={dismiss}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
