"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyPlusIcon,
  PencilIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";

import { PdfPreview } from "@/components/documents/pdf-preview";
import { FlagList } from "@/components/jobs/kit-documents";
import { LocalDate } from "@/components/jobs/local-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BuiltCvDetail } from "@/lib/dal/cvs";
import { builtCvQuery } from "@/lib/cvs/queries";
import { isBuildActive, type BuiltCvStatus } from "@/lib/schemas/cv-builder";
import { cn } from "@/lib/utils";

import { KeywordCoverage } from "./keyword-coverage";
import { LENGTH_LABELS, SECTION_LABELS } from "./labels";

// One built CV: its progress while Claude writes it, then the PDF with the
// ATS check beside it. The page prefetches it; this polls GET /api/cvs/[id]
// until it's ready.

const STEPS = [
  "writing",
  "checking",
  "rendering",
] as const satisfies readonly BuiltCvStatus[];

const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  writing: "Writing from your profile",
  checking: "Checking every claim",
  rendering: "Fitting it to the page",
};

export function BuiltCvView({ id }: { id: string }) {
  const { data: cv } = useSuspenseQuery(builtCvQuery(id));
  const again = `/cvs/new?from=${cv.id}`;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/cvs"
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          CVs
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {cv.request.targetTitle}
            </h1>
            <p className="text-sm text-muted-foreground">
              {cv.edited ? "Edited by you" : "Built"}{" "}
              <LocalDate iso={cv.createdAt} withTime />
              {cv.request.jobText ? " to match a job posting" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {cv.status === "ready" || cv.status === "failed" ? (
              <Link
                href={again}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                )}
              >
                <CopyPlusIcon aria-hidden data-icon="inline-start" />
                {cv.edited
                  ? "Have Claude build one"
                  : "Build another like this"}
              </Link>
            ) : null}
            {cv.status === "ready" ? (
              <Link
                href={`/cvs/edit?cv=${cv.id}`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                <PencilIcon aria-hidden data-icon="inline-start" />
                Edit
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {cv.status === "failed" ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>This CV didn&apos;t finish</AlertTitle>
          <AlertDescription>
            <p>{cv.error ?? "Something went wrong."}</p>
            <Link
              href={again}
              className="mt-1 font-semibold underline underline-offset-4"
            >
              Build it again
            </Link>
          </AlertDescription>
        </Alert>
      ) : cv.status === "ready" && cv.pdfUrl ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <PdfPreview url={cv.pdfUrl} title={cv.request.targetTitle} />
          <aside className="flex min-w-0 flex-col gap-4">
            <AtsCheck cv={cv} />
            {cv.edited ? null : <Asked cv={cv} />}
          </aside>
        </div>
      ) : isBuildActive(cv) ? (
        <BuildProgress status={cv.status} edited={cv.edited} />
      ) : null}
    </div>
  );
}

function BuildProgress({
  status,
  edited,
}: {
  status: BuiltCvStatus;
  /** An edited CV is written already: only its PDF is drawn. */
  edited: boolean;
}) {
  const current = STEPS.indexOf(status as (typeof STEPS)[number]);
  const steps = edited ? STEPS.filter((step) => step === "rendering") : STEPS;
  return (
    <section
      aria-labelledby="progress-heading"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <Spinner aria-hidden className="mt-1 size-5 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 id="progress-heading" className="font-semibold">
            Building your CV
          </h2>
          <p className="text-sm text-muted-foreground">
            It takes {edited ? "a few seconds" : "about a minute"}. You can
            leave this page; the CV is saved on the CVs page when it&apos;s
            done.
          </p>
        </div>
      </div>
      <ol
        className={cn("grid gap-2", !edited && "sm:grid-cols-3")}
        aria-label="Steps"
      >
        {steps.map((step) => {
          const index = STEPS.indexOf(step);
          const done = index < current;
          const now = index === current;
          return (
            <li
              key={step}
              aria-current={now ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
                now && "border-primary/50 bg-primary/5 font-medium",
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
              {STEP_LABELS[step]}
              {done ? <span className="sr-only"> (done)</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-success-ink"
      />
      <span>{children}</span>
    </li>
  );
}

const pages = (count: number) => (count === 1 ? "1 page" : `${count} pages`);

/** What makes the CV safe to send: layout, length, claims and keywords. */
function AtsCheck({ cv }: { cv: BuiltCvDetail }) {
  return (
    <Card title="ATS check">
      <ul className="flex flex-col gap-2 text-sm">
        <CheckLine>
          One column with standard headings, and text an applicant tracking
          system reads in order.
        </CheckLine>
        {cv.pageCount ? (
          <CheckLine>
            {pages(cv.pageCount)}
            {cv.trimmed > 0
              ? `, with ${cv.trimmed} older ${cv.trimmed === 1 ? "line" : "lines"} left out to fit.`
              : "."}
          </CheckLine>
        ) : null}
        {cv.edited && !cv.checkError && cv.flags.length === 0 ? (
          <li className="flex items-start gap-2 text-success-ink">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              You picked every line from your profile or a CV you edited, and
              each still cites your profile.
            </span>
          </li>
        ) : null}
        {!cv.edited &&
        !cv.checkError &&
        cv.flags.length === 0 &&
        cv.checkedAt ? (
          <li className="flex items-start gap-2 text-success-ink">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {cv.lines === 1
                ? "Its one claim cites"
                : `All ${cv.lines} claims cite`}{" "}
              your profile, and Claude checked each against it.
            </span>
          </li>
        ) : null}
      </ul>
      {cv.checkError ? (
        <Alert className="border-warning/40 bg-warning-soft">
          <TriangleAlertIcon aria-hidden className="text-warning-ink" />
          <AlertTitle>Not double-checked</AlertTitle>
          <AlertDescription>{cv.checkError}</AlertDescription>
        </Alert>
      ) : null}
      {cv.flags.length > 0 ? (
        <FlagList
          flags={cv.flags}
          note="These aren't backed by your profile, so they're left out of the PDF."
        />
      ) : null}
      {cv.keywords.length > 0 ? (
        <div className="border-t pt-3">
          <KeywordCoverage keywords={cv.keywords} then="build again" />
        </div>
      ) : null}
    </Card>
  );
}

/** The builder's form as it was sent. */
function Asked({ cv }: { cv: BuiltCvDetail }) {
  const { request } = cv;
  const rows: [string, React.ReactNode][] = [
    ["Length", LENGTH_LABELS[request.length].title],
    [
      "Sections",
      ["Summary", "Skills", "Experience"]
        .concat(request.sections.map((section) => SECTION_LABELS[section]))
        .join(", "),
    ],
  ];
  if (request.skills.length > 0) {
    rows.push(["Leads with", request.skills.join(", ")]);
  }
  if (request.note) rows.push(["Note", request.note]);
  return (
    <Card title="What you asked for">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {request.jobText ? (
        <details className="group text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            The job posting
          </summary>
          <p className="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted p-2.5 text-xs whitespace-pre-wrap">
            {request.jobText}
          </p>
        </details>
      ) : null}
    </Card>
  );
}
