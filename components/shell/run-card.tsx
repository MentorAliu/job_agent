import Link from "next/link";

import { LocalDate } from "@/components/jobs/local-date";
import { formatBudget, formatCost } from "@/components/runs/run-labels";
import { Skeleton } from "@/components/ui/skeleton";
import { getLatestRun, type RunSummary } from "@/lib/dal/runs";
import { requireUser } from "@/lib/dal/session";
import { getMonthBudget } from "@/lib/dal/spend";
import { DAILY_RUN_TIME } from "@/lib/jobs/today";
import { cn } from "@/lib/utils";

const WHEN: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/** The sidebar's card: the latest search, and this month's spend. */
export async function RunCard() {
  await requireUser();
  const [latest, budget] = await Promise.all([
    getLatestRun(),
    getMonthBudget(),
  ]);
  const share =
    budget.limitUsd > 0 ? Math.min(1, budget.spentUsd / budget.limitUsd) : 1;

  return (
    <Link
      href="/runs"
      className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-xs shadow-xs outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <LatestRun latest={latest} />
      <span className="mt-1.5 flex items-center justify-between gap-2 text-muted-foreground">
        <span>This month</span>
        <span className="font-semibold text-foreground tabular-nums">
          {formatCost(budget.spentUsd)} of {formatBudget(budget.limitUsd)}
        </span>
      </span>
      <span
        aria-hidden
        className="h-1.25 overflow-hidden rounded-full bg-track"
      >
        <span
          className={cn(
            "block h-full rounded-full",
            share >= 1
              ? "bg-destructive"
              : share >= 0.8
                ? "bg-warning"
                : "bg-primary",
          )}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </Link>
  );
}

function LatestRun({ latest }: { latest: RunSummary | null }) {
  if (!latest) {
    return (
      <>
        <Title dot="bg-neutral">No searches yet</Title>
        <span className="text-muted-foreground">
          The first one runs at {DAILY_RUN_TIME}, or start it on Runs.
        </span>
      </>
    );
  }

  const when = <LocalDate iso={latest.startedAt} format={WHEN} />;
  const scored = latest.stats.toScore - latest.stats.scoreFailed;
  const counts = `${latest.saved} new · ${scored} scored · ${formatCost(latest.costUsd)}`;

  switch (latest.status) {
    case "running":
      return (
        <>
          <Title dot="animate-pulse bg-primary">Searching now</Title>
          <span className="text-muted-foreground">Started {when}</span>
        </>
      );
    case "failed":
      return (
        <>
          <Title dot="bg-destructive">Last search failed</Title>
          <span className="text-muted-foreground">{when}</span>
        </>
      );
    case "stopped":
      return (
        <>
          <Title dot="bg-warning">Search stopped early</Title>
          <span className="text-muted-foreground">
            {when} · {counts}
          </span>
        </>
      );
    case "succeeded":
      return (
        <>
          <Title dot="bg-success">Searched {when}</Title>
          <span className="text-muted-foreground">{counts}</span>
        </>
      );
  }
}

function Title({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[0.8125rem] font-semibold">
      <span
        aria-hidden
        className={cn("size-1.75 shrink-0 rounded-full", dot)}
      />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function RunCardSkeleton() {
  return <Skeleton className="h-[5.75rem] rounded-lg" />;
}
