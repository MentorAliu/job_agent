"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  DoorClosedIcon,
  ExternalLinkIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { RoleEmails } from "@/components/emails/role-emails";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isApplied } from "@/lib/applications/progress";
import type { ApplyKit } from "@/lib/dal/apply-kit";
import { AUTO_KITS_PER_DAY } from "@/lib/jobs/auto-pick";
import { answerProgress } from "@/lib/jobs/kit-steps";
import { applyKitQuery } from "@/lib/jobs/queries";
import {
  DOCUMENT_KINDS,
  isTailoringActive,
  TAILOR_STAGES,
  type TailorStage,
  type TailorState,
} from "@/lib/schemas/tailor";
import { cn } from "@/lib/utils";

import { KitDocuments, type KitTab } from "./kit-documents";
import { KitFooter, PhoneApplyBar, PostingAsks, SendPanel } from "./kit-send";
import {
  DOCUMENT_LABELS,
  formatDay,
  formatSalary,
  formatWhere,
  outboundRel,
  postingLinkLabel,
} from "./labels";
import { CompanyTile } from "./company-tile";
import { RemoveRole } from "./remove-role";
import { useSetStatus } from "./job-actions";
import { ScoreRing } from "./score-ring";
import { StatusMenu } from "./status-menu";
import { useMarkApplied, useTailor } from "./use-job-actions";

const STEPS = TAILOR_STAGES.filter(
  (stage): stage is Exclude<TailorStage, "queued" | "done"> =>
    stage !== "queued" && stage !== "done",
);

const STAGE_LABELS: Record<(typeof STEPS)[number], string> = {
  researching: "Researching the company",
  writing: "Writing the documents",
  checking: "Checking every claim",
  rendering: "Drawing the PDFs",
};

/**
 * The apply kit for one role: the tailored CV, cover letter and answers in
 * tabs, with the kit and Mark as applied beside them. There's nothing to
 * fill in: the app wrote the kit when it picked the role. The page
 * prefetches the kit and its emails; this polls GET /api/jobs/[id]/kit while
 * Claude tailors the role. Once the role is applied to, its emails are on
 * its application's page, which Mark as applied opens.
 */
export function ApplyKitView({ jobId }: { jobId: string }) {
  const { data: kit, isError } = useSuspenseQuery(applyKitQuery(jobId));
  const [tab, setTab] = useState<KitTab>("cv");
  const markApplied = useMarkApplied();
  const router = useRouter();
  const active = isTailoringActive(kit.tailoring);
  const hasDocuments = Boolean(kit.cv || kit.letter || kit.answers);

  // The answers, at the first one left to the owner, ready to type.
  const openAnswers = () => {
    flushSync(() => setTab("answers"));
    const [first] = answerProgress(kit.answers).forYou;
    const card = first ? document.getElementById(`answer-${first.id}`) : null;
    if (!card) return;
    (card.querySelector("textarea") ?? card).focus({ preventScroll: true });
    card.scrollIntoView({ block: "center" });
  };
  const onMarkApplied = () =>
    markApplied.mutate(
      { jobId: kit.job.id },
      { onSuccess: () => router.push(`/applications/${kit.job.id}`) },
    );

  return (
    <div className="flex flex-col gap-6">
      <KitHeader job={kit.job} />

      {kit.job.aiPolicy ? (
        <Alert className="border-warning/40 bg-warning-soft">
          <TriangleAlertIcon aria-hidden className="text-warning-ink" />
          <AlertTitle>This posting has a rule on using AI</AlertTitle>
          <AlertDescription>
            <blockquote className="italic">“{kit.job.aiPolicy}”</blockquote>
            <p>Read it before you send anything Claude wrote.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {kit.job.status === "listing_closed" ? (
        <Alert>
          <DoorClosedIcon aria-hidden />
          <AlertTitle>The employer closed this listing</AlertTitle>
          <AlertDescription>
            The posting is no longer taking applications. If it&apos;s still
            open, change the status above.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Emails pasted before the role was applied to, if any. */}
      {isApplied(kit.job.status) ? null : (
        <RoleEmails
          jobId={kit.job.id}
          company={kit.job.company}
          applied={false}
        />
      )}

      {/* Announces tailoring's progress and end, which the kit shows by
          swapping parts in and out. */}
      <p role="status" className="sr-only">
        {kitStatusText(kit, hasDocuments)}
      </p>
      {isError && active ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t check on the tailoring. Retrying…
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <TailoringStatus kit={kit} hasDocuments={hasDocuments} />
          {hasDocuments || kit.brief ? (
            <KitDocuments kit={kit} tab={tab} onTabChange={setTab} />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          {hasDocuments || kit.application ? (
            <SendPanel
              kit={kit}
              active={active}
              marking={markApplied.isPending}
              onMarkApplied={onMarkApplied}
              onAnswer={openAnswers}
            />
          ) : null}
          <PostingAsks rules={kit.job.applicationRules} />
          <KitFooter costUsd={kit.costUsd} />
        </div>
      </div>

      {hasDocuments ? (
        <PhoneApplyBar
          kit={kit}
          active={active}
          marking={markApplied.isPending}
          onMarkApplied={onMarkApplied}
        />
      ) : null}
    </div>
  );
}

/** The role, where it stands, and the way back to the list. */
function KitHeader({ job }: { job: ApplyKit["job"] }) {
  const facts = [
    job.company,
    formatWhere(job.workplace, job.places),
    job.salary ? formatSalary(job.salary) : null,
    job.deadline ? `apply by ${formatDay(job.deadline)}` : null,
  ].filter(Boolean);
  const applied = isApplied(job.status);

  return (
    <header className="flex flex-col gap-4">
      <Link
        href={applied ? `/applications/${job.id}` : "/jobs"}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        {applied ? "Application" : "Roles"}
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
          {job.score !== null ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScoreRing score={job.score} size="sm" />
              <span aria-hidden>match</span>
            </span>
          ) : null}
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
          <RemoveRole job={job} variant="header" />
        </div>
      </div>
    </header>
  );
}

/** One line on where tailoring is, for screen readers. */
function kitStatusText(kit: ApplyKit, hasDocuments: boolean): string {
  const state = kit.tailoring;
  if (state && isTailoringActive(state)) {
    return state.stage in STAGE_LABELS
      ? `${STAGE_LABELS[state.stage as keyof typeof STAGE_LABELS]}…`
      : "Tailoring is waiting to start.";
  }
  if (state?.status === "failed") return "Tailoring didn't finish.";
  return hasDocuments ? "The documents are ready." : "";
}

/** Tailoring's progress, its failure, or the button that starts it. */
function TailoringStatus({
  kit,
  hasDocuments,
}: {
  kit: ApplyKit;
  hasDocuments: boolean;
}) {
  const tailor = useTailor();
  const state = kit.tailoring;
  const start = () =>
    tailor.mutate({ jobId: kit.job.id, kinds: [...DOCUMENT_KINDS], note: "" });

  if (state && isTailoringActive(state)) {
    return <TailoringProgress state={state} />;
  }

  const failed = state?.status === "failed" ? state : null;
  const startError = tailor.error?.message;
  const problems = (
    <>
      {failed ? <FailedAlert state={failed} /> : null}
      {startError ? (
        <p role="alert" className="text-sm text-destructive">
          {startError}
        </p>
      ) : null}
    </>
  );

  if (hasDocuments) {
    // An empty wrapper would still take a gap in the column.
    return failed || startError ? (
      <div className="flex flex-col gap-2">{problems}</div>
    ) : null;
  }
  if (!kit.canTailor) return <NotPicked job={kit.job} />;

  return (
    <section
      aria-labelledby="tailor-heading"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
        >
          <SparklesIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="tailor-heading" className="font-semibold">
            {failed ? "The kit didn't finish" : "No kit yet"}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Claude looks up the company, then rewords your CV for this role,
            writes a cover letter and answers likely questions, using only facts
            from your profile. It takes about a minute.
          </p>
        </div>
      </div>
      {problems}
      <Button className="w-fit" onClick={start} disabled={tailor.isPending}>
        <SparklesIcon aria-hidden data-icon="inline-start" />
        {failed ? "Try again" : "Write the kit"}
      </Button>
    </section>
  );
}

/** Why a role has no kit, and what Prepare kit costs. */
function prepareCopy(job: ApplyKit["job"]): string | null {
  // The app never picks a role the owner added; it tried when it was added.
  if (job.status === "new" && job.addedByOwner) {
    return "You added this role, and its kit couldn't start then. Prepare it when you're ready; it costs about 5 cents.";
  }
  const copy = PREPARE_COPY[job.status];
  return copy
    ? `${copy} Prepare a kit if you want to send it anyway; it costs about 5 cents.`
    : null;
}

const PREPARE_COPY: Partial<Record<ApplyKit["job"]["status"], string>> = {
  new: `This role is waiting for a free kit: the app writes up to ${AUTO_KITS_PER_DAY} a day.`,
  skipped: "The app passed over this role.",
  not_eligible: "This role was marked not eligible.",
};

/**
 * A role the app didn't pick has no kit. Prepare kit picks it, which starts
 * writing one.
 */
function NotPicked({ job }: { job: ApplyKit["job"] }) {
  const setStatus = useSetStatus();
  const copy = prepareCopy(job);
  if (!copy) return null;
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      <p>{copy}</p>
      <Button size="sm" onClick={() => setStatus(job, "shortlisted")}>
        <SparklesIcon aria-hidden data-icon="inline-start" />
        Prepare kit
      </Button>
    </div>
  );
}

function TailoringProgress({ state }: { state: TailorState }) {
  const steps = STEPS.filter((stage) =>
    // An edit only draws its PDF, and the company is researched only on
    // the first tailoring.
    state.edit
      ? stage === "rendering"
      : stage !== "researching" || state.stage === "researching",
  );
  const current = TAILOR_STAGES.indexOf(state.stage);
  // The button that started tailoring is gone, so focus would be lost.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body) ref.current?.focus();
  }, []);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="tailoring-heading"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 outline-none sm:p-6"
    >
      <div className="flex items-start gap-3">
        <Spinner aria-hidden className="mt-1 size-5 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 id="tailoring-heading" className="font-semibold">
            {state.edit
              ? "Saving your edited CV"
              : `${state.note ? "Regenerating" : "Tailoring"} ${
                  state.kinds.length === DOCUMENT_KINDS.length
                    ? "your application"
                    : state.kinds
                        .map((kind) => DOCUMENT_LABELS[kind])
                        .join(" and ")
                }`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {state.status === "queued"
              ? "Waiting for the background worker to pick it up."
              : "You can leave this page; the kit fills in when it's done."}
          </p>
        </div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2" aria-label="Steps">
        {steps.map((stage) => {
          const index = TAILOR_STAGES.indexOf(stage);
          const done = index < current;
          const now = index === current;
          return (
            <li
              key={stage}
              aria-current={now ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
                now && "border-primary/50 bg-primary/5 font-medium",
                done && "text-foreground",
                !done && !now && "text-muted-foreground",
              )}
            >
              {now ? (
                <Spinner aria-hidden className="text-primary" />
              ) : done ? (
                <span
                  aria-hidden
                  className="grid size-4 place-items-center rounded-full bg-success text-white"
                >
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <span
                  aria-hidden
                  className="size-4 rounded-full border-2 border-border"
                />
              )}
              {state.edit && stage === "rendering"
                ? "Drawing the PDF"
                : STAGE_LABELS[stage]}
              {done ? <span className="sr-only"> (done)</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FailedAlert({ state }: { state: TailorState }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>
        {state.edit
          ? "Saving your edited CV"
          : state.note
            ? "Regenerating"
            : "Tailoring"}{" "}
        didn&apos;t finish
      </AlertTitle>
      <AlertDescription>
        {state.error ?? "Something went wrong."}
      </AlertDescription>
    </Alert>
  );
}
