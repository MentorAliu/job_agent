import { ArrowRightIcon, ClockIcon, ListChecksIcon } from "lucide-react";
import Link from "next/link";

import { LocalDate } from "@/components/jobs/local-date";
import { formatCost, progressLine } from "@/components/runs/run-labels";
import { buttonVariants } from "@/components/ui/button";
import type { RunSummary } from "@/lib/dal/runs";
import { isRunActive } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

import { Panel } from "./panel";

const WHEN: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/** The latest search in one line, with a link to its run. */
export function LastSearchStrip({ latest }: { latest: RunSummary | null }) {
  if (!latest) return null;
  const active = isRunActive(latest.status);
  const scored = latest.stats.toScore - latest.stats.scoreFailed;
  const facts = active
    ? [progressLine(latest)]
    : latest.status === "failed"
      ? ["Failed", latest.stats.stopReason].filter(Boolean)
      : [
          `${latest.stats.read} ${latest.stats.read === 1 ? "page" : "pages"} read`,
          `${latest.saved} new`,
          `${scored} scored`,
          formatCost(latest.costUsd),
        ];
  return (
    <section
      aria-label="Last search"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-[0.8125rem] shadow-xs sm:px-5"
    >
      <span className="flex items-center gap-2 font-semibold">
        <ClockIcon aria-hidden className="size-4 text-muted-foreground" />
        {active ? "Searching now" : "Last search"}
      </span>
      <LocalDate
        iso={latest.startedAt}
        format={WHEN}
        className="text-muted-foreground"
      />
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        {facts.map((fact) => (
          <li
            key={fact}
            className="tabular-nums sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0"
          >
            {fact}
          </li>
        ))}
      </ul>
      <Link
        href={`/runs/${latest.id}`}
        className="ml-auto inline-flex items-center gap-1 rounded-sm font-semibold text-primary-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        View run
        <ArrowRightIcon aria-hidden className="size-3.5" />
      </Link>
    </section>
  );
}

/** What's left to do before the first search can run. */
export function SetupCard({ missing }: { missing: string[] }) {
  return (
    <Panel
      title="Before the first search"
      icon={<ListChecksIcon />}
      tone="warning"
    >
      <div className="flex flex-col gap-4 px-4 pb-5 sm:px-5">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/profile"
            className={cn(buttonVariants({ variant: "outline" }), "bg-card")}
          >
            Open your profile
          </Link>
          <Link
            href="/profile/preferences"
            className={cn(buttonVariants({ variant: "outline" }), "bg-card")}
          >
            Open your job preferences
          </Link>
        </div>
      </div>
    </Panel>
  );
}
