"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { ELIGIBILITY_LABELS } from "@/components/runs/run-labels";
import type { JobDetail } from "@/lib/dal/jobs";
import { feedBoardName } from "@/lib/jobs/feed-boards";
import { postedAgo } from "@/lib/jobs/posted";
import { jobDetailQuery } from "@/lib/jobs/queries";
import type { Eligibility } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

import { describeEvent } from "./event-labels";
import {
  formatDay,
  formatLevel,
  formatSalary,
  postingSite,
  WORKPLACE_LABELS,
} from "./labels";
import { LocalDate } from "./local-date";

// Under the apply kit: why the role scored what it did, its key facts, and
// what happened to it. All of it is to read.

/**
 * The role's score reasons, key facts and timeline, prefetched by the page.
 * They refresh with the kit whenever a write to the role settles.
 */
export function RoleDetails({ jobId }: { jobId: string }) {
  const { data: job } = useSuspenseQuery(jobDetailQuery(jobId));
  return (
    <section
      id="role-details"
      aria-labelledby="role-details-heading"
      className="flex scroll-mt-20 flex-col gap-4"
    >
      <h2 id="role-details-heading" className="text-lg font-semibold">
        About the role
      </h2>
      <WhyItScored job={job} />
      <div className="grid gap-6 md:grid-cols-2">
        <KeyFacts job={job} />
        <Timeline job={job} />
      </div>
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ReasonList({
  items,
  icon,
  empty,
}: {
  items: string[];
  icon: React.ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          {icon}
          {item}
        </li>
      ))}
    </ul>
  );
}

/** What Claude saw in the role, and what it found missing. */
function WhyItScored({ job }: { job: JobDetail }) {
  if (!job.scoreReasons) return null;
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5 md:grid-cols-2">
      <Section title={`Why it scored ${job.score ?? ""}`.trim()}>
        <ReasonList
          items={job.scoreReasons.reasons}
          empty="Claude gave no reasons."
          icon={
            <CheckIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-success"
            />
          }
        />
      </Section>
      <Section title="Gaps">
        <ReasonList
          items={job.scoreReasons.gaps}
          empty="None that Claude saw."
          icon={
            <TriangleAlertIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
          }
        />
      </Section>
    </div>
  );
}

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Takes the whole row, for a quote or a list. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card px-3 py-2", wide && "col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const QUOTE_LOOKS: Record<Eligibility, string> = {
  eligible: "bg-success-soft",
  unclear: "bg-warning-soft",
  not_eligible: "bg-destructive-soft",
};

const DAY_AND_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function KeyFacts({ job }: { job: JobDetail }) {
  const facts = job.facts;
  const today = job.today;
  return (
    <Section title="Key facts">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-sm">
        <Fact label="Eligibility">
          {job.eligibility
            ? ELIGIBILITY_LABELS[job.eligibility]
            : "Not checked"}
        </Fact>
        <Fact label="Workplace">
          {WORKPLACE_LABELS[job.workplace ?? "unclear"]}
          {job.places.length > 0 ? `: ${job.places.join(", ")}` : null}
        </Fact>
        <Fact label="Salary">
          {job.salary ? formatSalary(job.salary) : "Not given"}
        </Fact>
        <Fact label="Seniority">
          {formatLevel(job.seniority, job.contract) ?? "Not clear"}
        </Fact>
        <Fact label="Found">
          <LocalDate iso={job.foundAt} format={DAY_AND_TIME} />
        </Fact>
        {job.appliedAt ? (
          <Fact label="Applied">
            <LocalDate iso={job.appliedAt} format={DAY_AND_TIME} />
          </Fact>
        ) : job.deadline ? (
          <Fact label={job.deadline < today ? "Deadline passed" : "Apply by"}>
            {formatDay(job.deadline)}
          </Fact>
        ) : (
          <Fact label="Applied">Not yet</Fact>
        )}
        {job.postedOn ? (
          <Fact label="Posted" wide>
            {formatDay(job.postedOn)}, {postedAgo(job.postedOn, today)}
          </Fact>
        ) : null}
        {job.appliedAt && job.deadline ? (
          <Fact label="Deadline" wide>
            {formatDay(job.deadline)}
          </Fact>
        ) : null}
        {facts?.timeZones.quote ? (
          <Fact label="Time zones" wide>
            <span className="font-normal">“{facts.timeZones.quote}”</span>
          </Fact>
        ) : null}
      </dl>
      {job.eligibilityQuote ? (
        <blockquote
          className={cn(
            "rounded-lg px-3 py-2 text-[0.8125rem] italic",
            QUOTE_LOOKS[job.eligibility ?? "unclear"],
          )}
        >
          “{job.eligibilityQuote}”
        </blockquote>
      ) : null}
      {job.eligibilityReasons.length > 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {job.eligibilityReasons.join(" ")}
        </p>
      ) : null}
      {job.stack.length > 0 ? (
        <ul aria-label="Stack" className="flex flex-wrap gap-1.5">
          {job.stack.map((tool) => (
            <li
              key={tool}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {tool}
            </li>
          ))}
        </ul>
      ) : null}
      {job.summary ? (
        <p className="text-sm text-pretty">{job.summary}</p>
      ) : null}
      {facts && facts.requirements.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">Must-haves</h4>
          <ul className="list-disc pl-5 text-sm marker:text-muted-foreground">
            {facts.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/** How the role came in: added by the owner, from a board's feed, or a search. */
function foundTitle(job: JobDetail): string {
  if (job.addedByOwner) return "Added by you";
  const board = feedBoardName(job.url);
  return board ? `Found on ${board}` : "Found by a search";
}

function Timeline({ job }: { job: JobDetail }) {
  const today = job.today;
  const entries: {
    id: string;
    at: string;
    title: string;
    detail: string | null;
    dot: string;
  }[] = [
    // Follow-up dates are set by the app and no longer shown anywhere.
    ...job.events
      .filter(
        (event) =>
          event.type !== "follow_up_set" && event.type !== "follow_up_cleared",
      )
      .map((event) => ({
        id: event.id,
        at: event.at,
        ...describeEvent(event, today),
      })),
    {
      id: "found",
      at: job.foundAt,
      title: foundTitle(job),
      detail: postingSite(job.url),
      dot: "bg-neutral",
    },
  ];
  return (
    <Section title="Timeline">
      <ol className="flex flex-col">
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-3 pb-3 last:pb-0"
          >
            <span aria-hidden className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-1.5 size-2.5 shrink-0 rounded-full ring-3 ring-background",
                  entry.dot,
                )}
              />
              {index < entries.length - 1 ? (
                <span className="mt-1 -mb-2 w-px flex-1 bg-border" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{entry.title}</span>
              {entry.detail ? (
                <span className="text-[0.8125rem] break-words text-muted-foreground">
                  {entry.detail}
                </span>
              ) : null}
            </span>
            <LocalDate
              iso={entry.at}
              format={DAY_AND_TIME}
              className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            />
          </li>
        ))}
      </ol>
    </Section>
  );
}
