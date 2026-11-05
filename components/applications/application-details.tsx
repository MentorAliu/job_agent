"use client";

import {
  ChevronRightIcon,
  FileTextIcon,
  ListChecksIcon,
  MailIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { PdfDialog } from "@/components/documents/pdf-dialog";
import { documentDetail } from "@/components/jobs/kit-send";
import {
  formatLevel,
  formatSalary,
  formatWhere,
} from "@/components/jobs/labels";
import { LocalDate } from "@/components/jobs/local-date";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { peopleWhoWrote } from "@/lib/applications/progress";
import type { ApplyKit } from "@/lib/dal/apply-kit";
import type { PastedEmailView } from "@/lib/dal/emails";
import type { JobDetail } from "@/lib/dal/jobs";
import { answerProgress, answersText } from "@/lib/jobs/kit-steps";
import { cn } from "@/lib/utils";

import { APPLICATION_DAY, initials } from "./labels";

// Beside the conversation: what went out with the application, the company
// and who there wrote, and the role at a glance. All of it is to read.

function Card({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function MoreLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-primary-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      <ChevronRightIcon aria-hidden className="size-3.5" />
    </Link>
  );
}

function DocumentRow({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-b-0">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4"
      >
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.8125rem] font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {action}
    </li>
  );
}

/** A document's text in a dialog, to read again before a reply or a call. */
function ReadDialog({
  title,
  description,
  copy,
  children,
}: {
  title: string;
  description: string;
  /** The whole text, for the copy button. */
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        Read<span className="sr-only"> the {title.toLowerCase()}</span>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div>
          <CopyButton text={copy} context={title} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What went out with the application, each part to read again. */
export function SentCard({ kit }: { kit: ApplyKit }) {
  const application = kit.application;
  const sent = new Map(
    application?.documents.map((document) => [document.kind, document.version]),
  );
  // Documents can't change once a role is applied to, so the kit's latest
  // version is the one that was sent.
  const cv = sent.has("cv") ? kit.cv : null;
  const letter = sent.has("cover_letter") ? kit.letter : null;
  const answers = sent.has("answers") ? kit.answers : null;
  const ready = answerProgress(answers).ready;

  return (
    <Card
      id="sent-heading"
      title="What you sent"
      aside={
        application ? (
          <LocalDate
            iso={application.appliedAt}
            format={APPLICATION_DAY}
            className="text-xs text-muted-foreground"
          />
        ) : null
      }
    >
      {cv || letter || answers ? (
        <ul className="-mt-1 flex flex-col">
          {cv ? (
            <DocumentRow
              icon={FileTextIcon}
              title={`CV, version ${cv.document.version}`}
              detail={documentDetail(cv.document, "PDF")}
              action={
                cv.document.pdfUrl ? (
                  // The viewer has the download.
                  <PdfDialog
                    url={cv.document.pdfUrl}
                    title={`CV for ${kit.job.company}`}
                    description={`Version ${cv.document.version}, as you sent it.`}
                    label={
                      <>
                        View<span className="sr-only"> the CV</span>
                      </>
                    }
                    size="xs"
                  />
                ) : null
              }
            />
          ) : null}
          {letter ? (
            <DocumentRow
              icon={MailIcon}
              title="Cover letter"
              detail={`${letter.view.paragraphs.length} paragraphs`}
              action={
                <ReadDialog
                  title="Cover letter"
                  description={`Version ${letter.document.version}, as you sent it to ${kit.job.company}.`}
                  copy={letter.text}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {letter.text}
                  </p>
                </ReadDialog>
              }
            />
          ) : null}
          {answers ? (
            <DocumentRow
              icon={ListChecksIcon}
              title="Answers"
              detail={`${ready.length} ${ready.length === 1 ? "answer" : "answers"}`}
              action={
                <ReadDialog
                  title="Answers"
                  description={`Version ${answers.document.version}, written for ${kit.job.company}'s form.`}
                  copy={answersText(answers)}
                >
                  <dl className="flex flex-col gap-4 text-sm">
                    {ready.map((item) => (
                      <div key={item.id} className="flex flex-col gap-1">
                        <dt className="font-medium">{item.question}</dt>
                        <dd className="whitespace-pre-wrap text-muted-foreground">
                          {item.answer}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </ReadDialog>
              }
            />
          ) : null}
        </ul>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          No tailored documents were recorded with it.
        </p>
      )}
      <MoreLink href={`/jobs/${kit.job.id}`}>Open the whole kit</MoreLink>
    </Card>
  );
}

/** About as long as the brief gets before it's folded. */
const BRIEF_FOLD = 240;

/** What Claude found about the company, and who there wrote. */
export function CompanyCard({
  company,
  brief,
  emails,
}: {
  company: string;
  brief: ApplyKit["brief"];
  emails: PastedEmailView[];
}) {
  const [open, setOpen] = useState(false);
  const people = peopleWhoWrote(emails, company);
  const long = (brief?.text.length ?? 0) > BRIEF_FOLD;
  if (!brief && people.length === 0) return null;
  return (
    <Card id="company-heading" title={company}>
      {brief ? (
        <div className="flex flex-col items-start gap-1">
          {/* Plain text: search results never render as HTML. */}
          <p
            id="company-brief"
            className={cn(
              "text-[0.8125rem] text-pretty whitespace-pre-line text-foreground/85",
              long && !open && "line-clamp-4",
            )}
          >
            {brief.text}
          </p>
          {long ? (
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0 text-muted-foreground"
              aria-expanded={open}
              aria-controls="company-brief"
              onClick={() => setOpen(!open)}
            >
              {open ? "Less" : "More"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {people.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            People who wrote
          </h3>
          <ul className="flex flex-col gap-2 text-[0.8125rem]">
            {people.map((person) => (
              <li key={person.name} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-neutral-soft text-[0.625rem] font-semibold text-muted-foreground"
                >
                  {initials(person.name)}
                </span>
                <span className="min-w-0 truncate">{person.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {person.count} {person.count === 1 ? "email" : "emails"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/** The role at a glance, and the way to why it scored what it did. */
export function RoleCard({ job }: { job: JobDetail }) {
  const facts = [
    ["Salary", job.salary ? formatSalary(job.salary) : "Not given"],
    ["Workplace", formatWhere(job.workplace, job.places)],
    ["Seniority", formatLevel(job.seniority, job.contract) ?? "Not clear"],
    ["Match", job.score !== null ? `${job.score} of 100` : "Not scored"],
  ] as const;
  return (
    <Card id="role-heading" title="The role">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[0.8125rem]">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {job.stack.length > 0 ? (
        <ul aria-label="Stack" className="flex flex-wrap gap-1.5">
          {job.stack.map((tool) => (
            <li
              key={tool}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tool}
            </li>
          ))}
        </ul>
      ) : null}
      <MoreLink href={`/jobs/${job.id}#role-details`}>
        {job.score !== null
          ? `Why it scored ${job.score}, and the timeline`
          : "Its facts and timeline"}
      </MoreLink>
    </Card>
  );
}
