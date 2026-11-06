"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { CheckIcon, CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import { LocalDate } from "@/components/jobs/local-date";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunJobView, RunView as Run } from "@/lib/dal/runs";
import { runQuery } from "@/lib/run-polling";
import { isRunActive, RUN_STAGES, type RunStage } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

import {
  duration,
  ELIGIBILITY_LABELS,
  formatCost,
  progressLine,
  STAGE_LABELS,
  STATUS_LABELS,
} from "./run-labels";
import { StageCostTable } from "./stage-costs";

const STEPS = RUN_STAGES.filter(
  (stage): stage is Exclude<RunStage, "queued" | "done"> =>
    stage !== "queued" && stage !== "done",
);

/**
 * One search run: its progress while it's going, then the postings it found.
 * The page prefetches it; this polls GET /api/runs/[id] every 2 seconds until
 * the run ends.
 */
export function RunView({ runId }: { runId: string }) {
  const { data: run, isError } = useSuspenseQuery(runQuery(runId));
  const active = isRunActive(run.status);
  const counts = {
    eligible: run.jobs.filter((job) => job.eligibility === "eligible").length,
    unclear: run.jobs.filter((job) => job.eligibility === "unclear").length,
    notEligible: run.jobs.filter((job) => job.eligibility === "not_eligible")
      .length,
    scored: run.jobs.filter((job) => job.score !== null).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link
            href="/runs"
            className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            All runs
          </Link>
        }
        title="Search run"
        description={
          <p>
            {run.trigger === "scheduled" ? "Daily run" : "Search now"}, started{" "}
            <LocalDate iso={run.startedAt} withTime />
            {run.finishedAt
              ? `, took ${duration(run.startedAt, run.finishedAt)}`
              : ""}
            . Cost so far: {formatCost(run.costUsd)}.
          </p>
        }
        actions={
          <Badge
            variant="secondary"
            className={cn(
              run.status === "failed" &&
                "bg-destructive-soft text-destructive-ink",
              run.status === "running" && "bg-primary-soft text-primary-ink",
              run.status === "stopped" && "bg-warning-soft text-warning-ink",
              run.status === "succeeded" && "bg-success-soft text-success-ink",
            )}
          >
            {active ? <Spinner aria-hidden /> : null}
            {STATUS_LABELS[run.status]}
          </Badge>
        }
      />

      {/* Announces each stage and the end of the run. */}
      <p role="status" className="sr-only">
        {active
          ? progressLine(run)
          : `Search ${STATUS_LABELS[run.status].toLowerCase()}.`}
      </p>

      {run.stats.stopReason ? (
        <Alert variant={run.status === "failed" ? "destructive" : "default"}>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            {run.status === "failed"
              ? "The search failed"
              : "The search stopped early"}
          </AlertTitle>
          <AlertDescription>{run.stats.stopReason}</AlertDescription>
        </Alert>
      ) : null}
      {isError && active ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t check on the search. Retrying…
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{active ? progressLine(run) : "Progress"}</h2>
          </CardTitle>
          <CardDescription>
            First the job boards of companies that already posted a role you can
            take are checked for new ones, then the feeds of remote job boards.
            Then Claude searches job boards and companies&apos; own careers
            pages, reads each new posting, checks whether you can work from
            where you are, and scores the matches.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="grid gap-3 sm:grid-cols-3" aria-label="Stages">
            {STEPS.map((stage) => {
              const state = stageState(run.stats.stage, stage, run.status);
              return (
                <li
                  key={stage}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    state === "current" && "border-foreground font-medium",
                    state === "todo" && "text-muted-foreground",
                  )}
                >
                  {state === "current" && active ? (
                    <Spinner aria-hidden />
                  ) : null}
                  {state === "done" ? (
                    <CheckIcon aria-hidden className="size-4" />
                  ) : null}
                  {STAGE_LABELS[stage]}
                  {state === "done" ? (
                    <span className="sr-only"> (done)</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {active &&
          run.stats.stage === "extracting" &&
          run.stats.toRead > 0 ? (
            <Progress
              value={(100 * run.stats.read) / run.stats.toRead}
              aria-label="Postings read"
            />
          ) : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Companies checked" value={run.stats.boards} />
            <Stat label="Their new roles" value={run.stats.boardPostings} />
            <Stat label="Board feeds read" value={run.stats.feeds} />
            <Stat label="Roles from feeds" value={run.stats.feedPostings} />
            <Stat label="Searches" value={run.stats.searches} />
            <Stat label="New links" value={run.stats.fresh} />
            <Stat label="Postings read" value={run.stats.read} />
            <Stat label="Saved" value={run.jobs.length} />
            <Stat label="Eligible" value={counts.eligible} />
            <Stat label="Unclear" value={counts.unclear} />
            <Stat label="Not eligible" value={counts.notEligible} />
            <Stat label="Scored" value={counts.scored} />
            <Stat label="Duplicates" value={run.stats.duplicates} />
            <Stat label="Skipped" value={run.stats.skipped} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Cost by step</h2>
          </CardTitle>
          <CardDescription>
            Tokens, web searches and cost of this run&apos;s Claude calls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {run.stageCosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {active
                ? "Nothing yet. Costs show up here as each call returns."
                : "This run made no Claude calls."}
            </p>
          ) : (
            <StageCostTable
              stages={run.stageCosts}
              caption="This run's Claude calls by step"
            />
          )}
        </CardContent>
      </Card>

      <section
        className="flex flex-col gap-3"
        aria-labelledby="postings-heading"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="postings-heading" className="text-lg font-semibold">
            Postings found
          </h2>
          {!active && counts.eligible + counts.unclear > 0 ? (
            <Link href="/" className="text-sm underline underline-offset-4">
              See what it picked on the Overview
            </Link>
          ) : null}
        </div>
        {run.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {active
              ? "Postings show up here as Claude reads them."
              : run.status === "succeeded"
                ? "This run found no new postings."
                : "This run stored no postings before it ended."}
          </p>
        ) : (
          <PostingsTable jobs={run.jobs} />
        )}
      </section>
    </div>
  );
}

function stageState(
  current: RunStage,
  stage: RunStage,
  status: Run["status"],
): "done" | "current" | "todo" {
  const order = RUN_STAGES.indexOf(current);
  const index = RUN_STAGES.indexOf(stage);
  if (current === "done") return status === "succeeded" ? "done" : "todo";
  if (index < order) return "done";
  return index === order ? "current" : "todo";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function PostingsTable({ jobs }: { jobs: RunJobView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Score</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Eligibility</TableHead>
          <TableHead>Why</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id} className="align-top">
            <TableCell className="text-lg font-semibold tabular-nums">
              {job.score ?? "—"}
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal">
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
              >
                {job.title}
                <ExternalLinkIcon className="size-3" aria-hidden />
                <span className="sr-only">
                  (opens the posting in a new tab)
                </span>
              </a>
              <div className="text-muted-foreground">{job.company}</div>
              {job.status === "skipped" ? (
                <div className="text-xs text-muted-foreground">
                  Excluded company
                </div>
              ) : null}
            </TableCell>
            <TableCell className="max-w-72 whitespace-normal">
              {job.eligibility ? (
                <Badge
                  variant={
                    job.eligibility === "eligible"
                      ? "default"
                      : job.eligibility === "not_eligible"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {ELIGIBILITY_LABELS[job.eligibility]}
                </Badge>
              ) : null}
              {job.eligibilityQuote ? (
                <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground italic">
                  “{job.eligibilityQuote}”
                </blockquote>
              ) : null}
              {job.eligibilityReasons.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.eligibilityReasons.join(" ")}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="max-w-96 whitespace-normal text-xs">
              {job.scoreReasons ? (
                <ScoreReasons reasons={job.scoreReasons} />
              ) : (
                <span className="text-muted-foreground">
                  {job.eligibility === "not_eligible" ||
                  job.status === "skipped"
                    ? "Not scored."
                    : "Waiting for a score."}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScoreReasons({
  reasons,
}: {
  reasons: NonNullable<RunJobView["scoreReasons"]>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {reasons.reasons.length > 0 ? (
        <ul className="list-disc pl-4">
          {reasons.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {reasons.gaps.length > 0 ? (
        <>
          <p className="font-medium">Gaps</p>
          <ul className="list-disc pl-4 text-muted-foreground">
            {reasons.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
