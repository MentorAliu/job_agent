"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, MailIcon, SendIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { progressLine } from "@/components/runs/run-labels";
import { buttonVariants } from "@/components/ui/button";
import {
  DEFAULT_ROLES_PARAMS,
  serializeRolesParams,
} from "@/lib/jobs/list-params";
import { jobsKey, topBarQuery } from "@/lib/jobs/queries";
import {
  kitsTodayLabel,
  searchHref,
  searchLabel,
  type NextStep,
  type SearchState,
  type SearchStatus,
} from "@/lib/jobs/top-bar";
import { runPollInterval, runQuery } from "@/lib/run-polling";
import { isRunActive } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

const DOTS: Record<SearchState, string> = {
  searching: "animate-pulse bg-primary",
  on: "bg-success",
  off: "bg-neutral",
  setup: "bg-warning",
  budget: "bg-warning",
  failed: "bg-destructive",
};

const NEW_ROLES_HREF = serializeRolesParams("/jobs", {
  ...DEFAULT_ROLES_PARAMS,
  tab: "all",
  only: ["new"],
});

/**
 * The top bar's contents: how the search is doing on the left, and on the
 * right the roles new since the owner last opened Roles and the one thing
 * that needs them. While a search runs it follows the run, and once the run
 * ends it refreshes the page so the new roles show. It does the same for
 * Claude's other work, such as kits, so the spend shows what it cost.
 */
export function TopBarStatus() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery(topBarQuery());

  const searching =
    data?.search.state === "searching" ? data.search.runId : null;
  const { data: run } = useQuery({
    ...runQuery(searching ?? ""),
    enabled: searching !== null,
    refetchInterval: (query) =>
      runPollInterval(query.state.data ?? { status: "running" }),
  });
  const ended =
    searching !== null && run !== undefined && !isRunActive(run.status);

  useEffect(() => {
    if (!ended) return;
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: jobsKey });
  }, [ended, router, queryClient]);

  // The bar checks back while Claude works (see topBarQuery). Once it's done,
  // the sidebar and the page get the new spend and kits.
  const working = data?.working ?? false;
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) {
      router.refresh();
      void queryClient.invalidateQueries({ queryKey: jobsKey });
    }
    wasWorking.current = working;
  }, [working, router, queryClient]);

  if (!data) return <div className="flex-1" />;
  // The run as last polled, or as the bar read it until the first poll.
  const stats = run
    ? isRunActive(run.status)
      ? run.stats
      : null
    : data.search.stats;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <SearchLine
        status={data.search}
        progress={stats ? progressLine({ stats }) : null}
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {data.newRoles > 0 ? <NewRoles count={data.newRoles} /> : null}
        <NextStepLink next={data.next} />
      </div>
    </div>
  );
}

/**
 * Where the search stands, and what's next. A phone has room for the first
 * part only; screen readers get it all from the label.
 */
function SearchLine({
  status,
  progress,
}: {
  status: SearchStatus;
  progress: string | null;
}) {
  const { title, detail } = searchLabel(status);
  const line = progress ?? detail;
  const kits =
    status.state !== "setup" ? kitsTodayLabel(status.kitsToday) : null;
  return (
    <Link
      href={searchHref(status)}
      // The words in full, without the dots between them.
      aria-label={[title, line, kits].filter(Boolean).join(". ")}
      title={status.reason ?? undefined}
      className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", DOTS[status.state])}
      />
      <span className="truncate font-medium">{title}</span>
      {line ? (
        <span className="min-w-0 truncate text-muted-foreground max-md:hidden">
          · {line}
        </span>
      ) : null}
      {kits ? (
        <span className="whitespace-nowrap text-muted-foreground max-lg:hidden">
          · {kits}
        </span>
      ) : null}
    </Link>
  );
}

function NewRoles({ count }: { count: number }) {
  return (
    <Link
      href={NEW_ROLES_HREF}
      title="Found since you last opened Roles"
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-3 text-sm font-medium whitespace-nowrap text-primary-ink outline-none hover:bg-primary-soft/70 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <SparklesIcon aria-hidden className="size-4" />
      <span className="tabular-nums">{count}</span>
      <span className="max-sm:sr-only">
        new {count === 1 ? "role" : "roles"}
      </span>
    </Link>
  );
}

/**
 * The reply or kit that's next. Not on a phone, where the tab bar's counts
 * say the same.
 */
function NextStepLink({ next }: { next: NextStep }) {
  if (next.kind === "none") {
    return (
      <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground max-md:hidden">
        <CheckIcon aria-hidden className="size-4 text-success" />
        Nothing needs you
      </span>
    );
  }
  const reply = next.kind === "reply";
  return (
    <Link
      href={reply ? `/applications/${next.jobId}` : `/jobs/${next.jobId}`}
      title={
        reply
          ? `${next.company} is waiting for your reply`
          : `The kit for ${next.company} is ready to send`
      }
      className={cn(buttonVariants(), "max-w-64 max-md:hidden")}
    >
      {reply ? (
        <MailIcon aria-hidden data-icon="inline-start" />
      ) : (
        <SendIcon aria-hidden data-icon="inline-start" />
      )}
      <span className="truncate">
        {reply ? "Reply to" : "Apply to"} {next.company}
      </span>
    </Link>
  );
}
