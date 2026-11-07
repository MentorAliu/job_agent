import { HistoryIcon } from "lucide-react";
import Link from "next/link";

import { LocalDate } from "@/components/jobs/local-date";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunListItem, RunPage } from "@/lib/dal/runs";
import { DAILY_RUN_TIME } from "@/lib/jobs/today";
import { isRunActive, RUN_TRIGGER_LABELS } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

import { duration, formatCost, progressLine } from "./run-labels";
import { RunStatusPill } from "./run-status-pill";

const WHEN: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/** On phones the table keeps Started and Cost, and Started takes the rest. */
const WIDE_ONLY = "max-md:hidden";

/** Every search run, newest first, a page at a time. */
export function RunHistory({
  history,
  dailyRun,
}: {
  history: RunPage;
  /** Whether the daily search is on in Settings. */
  dailyRun: boolean;
}) {
  const { runs, page, pageCount, perPage, total } = history;
  const first = (page - 1) * perPage + 1;
  return (
    <section
      aria-labelledby="runs-heading"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 sm:px-5">
        <h2 id="runs-heading" className="text-[0.9375rem] font-semibold">
          Search runs
        </h2>
        {total > 0 ? (
          <span className="text-[0.8125rem] text-muted-foreground">
            Newest first
          </span>
        ) : null}
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground sm:ml-auto">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 self-center rounded-full",
              dailyRun ? "bg-success" : "bg-neutral",
            )}
          />
          {dailyRun ? (
            `Daily run is on, every morning at ${DAILY_RUN_TIME}`
          ) : (
            <span>
              Daily run is off. Turn it on in{" "}
              <Link
                href="/settings"
                className="text-primary-ink underline underline-offset-4"
              >
                Settings
              </Link>
              .
            </span>
          )}
        </p>
      </div>
      {total === 0 ? (
        <Empty className="rounded-none border-t">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No searches yet</EmptyTitle>
            <EmptyDescription>
              Claude searches every morning at {DAILY_RUN_TIME} while the daily
              run is on in <Link href="/settings">Settings</Link>, or whenever
              you press Search now.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : runs.length === 0 ? (
        <p className="border-t px-4 py-6 text-sm text-muted-foreground sm:px-5">
          There are no runs on this page.{" "}
          <Link href="/runs" className="underline underline-offset-4">
            Go to the newest runs
          </Link>
          .
        </p>
      ) : (
        <>
          <Table>
            <caption className="sr-only">
              Search runs, newest first. Page {page} of {pageCount}.
            </caption>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <Head className="pl-4 sm:pl-5">Started</Head>
                <Head className={cn("w-full", WIDE_ONLY)}>Status</Head>
                <Head className={cn("text-right", WIDE_ONLY)}>Took</Head>
                <Head className={cn("text-right", WIDE_ONLY)}>
                  New postings
                </Head>
                <Head className={cn("text-right", WIDE_ONLY)}>Scored</Head>
                <Head className="pr-4 text-right sm:pr-5">Cost</Head>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </TableBody>
          </Table>
          <nav
            aria-label="Run pages"
            className="flex items-center justify-between gap-3 border-t px-4 py-3 text-[0.8125rem] text-muted-foreground sm:px-5"
          >
            <span className="tabular-nums">
              {first}–{first + runs.length - 1} of {total}
            </span>
            {pageCount > 1 ? (
              <span className="flex gap-2">
                <PageLink page={page - 1} disabled={page <= 1}>
                  Newer
                </PageLink>
                <PageLink page={page + 1} disabled={page >= pageCount}>
                  Older
                </PageLink>
              </span>
            ) : null}
          </nav>
        </>
      )}
    </section>
  );
}

function Head({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      scope="col"
      className={cn(
        "h-10 px-3 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

function RunRow({ run }: { run: RunListItem }) {
  const active = isRunActive(run.status);
  const note = active ? progressLine(run) : run.stats.stopReason;
  const took = run.finishedAt ? duration(run.startedAt, run.finishedAt) : null;
  return (
    <TableRow className="hover:bg-muted/40 *:align-top">
      <TableCell className="py-3 pl-4 whitespace-normal sm:pl-5">
        <Link
          href={`/runs/${run.id}`}
          className="rounded-sm font-semibold whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LocalDate iso={run.startedAt} format={WHEN} />
        </Link>
        <div className="text-xs text-muted-foreground">
          {RUN_TRIGGER_LABELS[run.trigger]}
        </div>
        <div className="mt-2 flex flex-col items-start gap-1 md:hidden">
          <RunStatusPill status={run.status} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {run.saved} new · {run.scored} scored
            {took ? ` · ${took}` : ""}
          </p>
          {note ? (
            <p className="text-xs text-muted-foreground">{note}</p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={cn("py-3 whitespace-normal", WIDE_ONLY)}>
        <RunStatusPill status={run.status} />
        {note ? (
          <p className="mt-1.5 max-w-96 text-xs text-muted-foreground">
            {note}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={cn("py-3 text-right tabular-nums", WIDE_ONLY)}>
        {took ?? "—"}
      </TableCell>
      <TableCell className={cn("py-3 text-right tabular-nums", WIDE_ONLY)}>
        {run.saved}
      </TableCell>
      <TableCell className={cn("py-3 text-right tabular-nums", WIDE_ONLY)}>
        {run.scored}
      </TableCell>
      <TableCell
        className={cn(
          "py-3 pr-4 text-right tabular-nums sm:pr-5",
          run.costUsd > 0 ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {formatCost(run.costUsd)}
      </TableCell>
    </TableRow>
  );
}

function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: string;
}) {
  const label = <span className="sr-only"> runs</span>;
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
        {label}
      </Button>
    );
  }
  return (
    <Link
      href={page === 1 ? "/runs" : `/runs?page=${page}`}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "bg-card",
      )}
    >
      {children}
      {label}
    </Link>
  );
}
