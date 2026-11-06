"use client";

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { useOnEmailsRead } from "@/components/emails/role-emails";
import { CompanyTile } from "@/components/jobs/company-tile";
import {
  formatSalary,
  formatWhere,
  outboundRel,
  postingLinkLabel,
} from "@/components/jobs/labels";
import { LocalDate } from "@/components/jobs/local-date";
import { StatusMenu } from "@/components/jobs/status-menu";
import { buttonVariants } from "@/components/ui/button";
import {
  applicationNow,
  applicationSteps,
  conversationItems,
  isApplied,
  type ApplicationStep,
  type StepKey,
} from "@/lib/applications/progress";
import type { JobDetail } from "@/lib/dal/jobs";
import {
  applyKitQuery,
  jobDetailQuery,
  jobsKey,
  roleEmailsQuery,
} from "@/lib/jobs/queries";
import { cn } from "@/lib/utils";

import { CompanyCard, RoleCard, SentCard } from "./application-details";
import { Conversation } from "./conversation";
import { APPLICATION_DAY } from "./labels";
import { NowCard } from "./now-card";

/**
 * One application: how far it got, what's the owner's to do now, and the
 * conversation with the company, with what was sent and the role beside
 * them. The page prefetches the role, its kit and its emails; the emails
 * poll while Claude reads one, and the rest refresh once it's read.
 */
export function ApplicationView({
  jobId,
  ownerInitial,
}: {
  jobId: string;
  /** For the owner's own emails in the conversation. */
  ownerInitial: string;
}) {
  const queryClient = useQueryClient();
  const { data: job } = useSuspenseQuery(jobDetailQuery(jobId));
  const { data: kit } = useSuspenseQuery(applyKitQuery(jobId));
  const { data: emails } = useSuspenseQuery(roleEmailsQuery(jobId));
  useOnEmailsRead(emails, () =>
    queryClient.invalidateQueries({
      queryKey: jobsKey,
      predicate: (query) => query.queryKey[1] !== "emails",
    }),
  );
  // Moved back to before applying, from the status menu: the role is a kit
  // again.
  if (!isApplied(job.status)) redirect(`/jobs/${jobId}`);

  const application = {
    status: job.status,
    appliedAt: job.appliedAt,
    emails,
    events: job.events,
  };
  const now = applicationNow(application);
  const items = conversationItems({
    appliedAt: job.appliedAt,
    documents: kit.application?.documents ?? [],
    emails,
    events: job.events,
  });

  return (
    <div className="flex flex-col gap-5">
      <ApplicationHeader job={job} />
      <Progress steps={applicationSteps(application)} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-7">
          <NowCard now={now} status={job.status} company={job.company} />
          <Conversation
            jobId={jobId}
            company={job.company}
            items={items}
            replyAtTop={now.kind === "reply" ? now.email.id : null}
            ownerInitial={ownerInitial}
          />
        </div>
        <aside
          aria-label="Details"
          className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20"
        >
          <SentCard kit={kit} />
          <CompanyCard
            company={job.company}
            brief={kit.brief}
            emails={emails}
          />
          <RoleCard job={job} />
        </aside>
      </div>
    </div>
  );
}

function ApplicationHeader({ job }: { job: JobDetail }) {
  const facts = [
    job.company,
    formatWhere(job.workplace, job.places),
    job.salary ? formatSalary(job.salary) : null,
  ].filter(Boolean);
  return (
    <header className="flex flex-col gap-4">
      <Link
        href="/applications"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Applications
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <CompanyTile company={job.company} className="max-sm:size-10" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
              {job.title}
            </h1>
            <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusMenu job={job} variant="pill" />
          <a
            href={job.url}
            target="_blank"
            rel={outboundRel(job.url)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {postingLinkLabel(job.url)}
            <ExternalLinkIcon aria-hidden data-icon="inline-end" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </header>
  );
}

const STEP_LABELS: Record<StepKey, string> = {
  applied: "Applied",
  replied: "They replied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Not going ahead",
  no_response: "No response",
  withdrawn: "Withdrawn",
};

/** The step it's at: a soft fill with a dot, in its status's color. */
const NOW_LOOKS: Record<StepKey, { mark: string; dot: string }> = {
  applied: {
    mark: "bg-status-applied-soft ring-status-applied",
    dot: "bg-status-applied",
  },
  replied: {
    mark: "bg-status-applied-soft ring-status-applied",
    dot: "bg-status-applied",
  },
  interviewing: {
    mark: "bg-status-interviewing-soft ring-status-interviewing",
    dot: "bg-status-interviewing",
  },
  offer: {
    mark: "bg-status-offer-soft ring-status-offer",
    dot: "bg-status-offer",
  },
  rejected: {
    mark: "bg-destructive-soft ring-destructive",
    dot: "bg-destructive",
  },
  no_response: { mark: "bg-neutral-soft ring-neutral", dot: "bg-neutral" },
  withdrawn: { mark: "bg-neutral-soft ring-neutral", dot: "bg-neutral" },
};

const COLUMNS = [
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-4",
  "grid-cols-5",
];

/** Applied, They replied, Interviewing and Offer, with when each happened. */
function Progress({ steps }: { steps: ApplicationStep[] }) {
  return (
    <ol
      aria-label="How far it got"
      className={cn(
        "grid rounded-xl border bg-card px-3 pt-4 pb-3.5 shadow-xs sm:px-5",
        COLUMNS[steps.length - 1],
      )}
    >
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.key}
            aria-current={step.state === "now" ? "step" : undefined}
            className="flex min-w-0 flex-col gap-2"
          >
            <span aria-hidden className="flex items-center">
              {step.state === "done" ? (
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success text-white">
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                </span>
              ) : step.state === "now" ? (
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full ring-2 ring-inset",
                    NOW_LOOKS[step.key].mark,
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      NOW_LOOKS[step.key].dot,
                    )}
                  />
                </span>
              ) : (
                <span className="size-6 shrink-0 rounded-full border-2 border-border" />
              )}
              {last ? null : (
                <span
                  className={cn(
                    "mx-1.5 h-0.5 flex-1 rounded-full sm:mx-2.5",
                    step.state === "done" ? "bg-success" : "bg-border",
                  )}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-px pr-1.5 sm:pr-4">
              <span
                className={cn(
                  "text-[0.8125rem] leading-tight font-semibold sm:text-sm",
                  step.state === "todo" && "text-muted-foreground",
                )}
              >
                {STEP_LABELS[step.key]}
                {step.state === "done" ? (
                  <span className="sr-only"> (done)</span>
                ) : null}
              </span>
              <StepDate step={step} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepDate({ step }: { step: ApplicationStep }) {
  const className = "text-xs text-muted-foreground";
  if (step.state === "todo") return <span className={className}>Not yet</span>;
  if (!step.at) return null;
  return (
    <span className={className}>
      {step.state === "now" && step.key === "interviewing" ? (
        // A phone's narrow steps have room for the date alone.
        <span className="max-sm:sr-only">Since </span>
      ) : null}
      <LocalDate iso={step.at} format={APPLICATION_DAY} />
    </span>
  );
}
