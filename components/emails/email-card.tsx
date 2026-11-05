"use client";

import {
  ArrowUpIcon,
  CheckIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  RotateCcwIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { STATUS_LABELS } from "@/components/jobs/labels";
import { RelativeDate } from "@/components/jobs/relative-date";
import { statusDot, StatusPill } from "@/components/jobs/status-pill";
import { useChangeStatus } from "@/components/jobs/use-job-actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { roleHref } from "@/lib/applications/progress";
import type { FiledEmailView, PastedEmailView } from "@/lib/dal/emails";
import { cn } from "@/lib/utils";

import { emailLabel, OUTCOME_STATUSES } from "./labels";
import {
  useDeleteEmail,
  useEmailHandled,
  useRetryEmail,
} from "./use-email-actions";

// One pasted email: what Claude made of it, what it did to the role, and the
// reply to send. Copying the reply counts as sending it.

/** The kind of email, as a dot and a word. */
export function EmailTag({ email }: { email: PastedEmailView }) {
  const unsure =
    email.author === "employer" &&
    email.outcome !== "unrelated" &&
    email.sure === false;
  const dot =
    email.author === "candidate" || !email.outcome
      ? "bg-neutral"
      : unsure
        ? "bg-warning"
        : statusDot(OUTCOME_STATUSES[email.outcome]);
  return (
    <span className="inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold whitespace-nowrap">
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {email.jobId === null && email.outcome === "unrelated"
        ? "No application found"
        : emailLabel(email)}
    </span>
  );
}

/** What reading the email did to its role, if anything, with a way back. */
function Effect({
  email,
  jobId,
}: {
  email: PastedEmailView;
  jobId: string | null;
}) {
  const changeStatus = useChangeStatus();
  const router = useRouter();
  if (email.moved && jobId) {
    const { from, to, undo } = email.moved;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span>
          Moved the role to <strong>{STATUS_LABELS[to]}</strong>.
        </span>
        {undo ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={changeStatus.isPending}
            onClick={() =>
              changeStatus.mutate(
                {
                  jobId,
                  status: from,
                  reason: "Undid the change an email made.",
                },
                { onSuccess: () => router.refresh() },
              )
            }
          >
            <UndoIcon aria-hidden data-icon="inline-start" />
            Undo, back to {STATUS_LABELS[from]}
          </Button>
        ) : null}
      </p>
    );
  }
  if (email.author !== "employer") return null;
  if (email.outcome === "unrelated") {
    // With no role, the picker below says it.
    if (!jobId) return null;
    return (
      <p className="text-sm text-muted-foreground">
        This doesn&apos;t look like it&apos;s about this application, so nothing
        changed.
      </p>
    );
  }
  if (email.sure === false) {
    return (
      <p className="text-sm text-warning-ink">
        Claude wasn&apos;t sure what this email means, so the status stayed as
        it was. Change it from the status menu if it should move.
      </p>
    );
  }
  return null;
}

/** The reply Claude suggests, to copy into the email client. */
function Reply({ email }: { email: PastedEmailView }) {
  const handled = useEmailHandled();
  if (!email.reply) return null;
  const done = email.handledAt !== null;
  const mark = (value: boolean) =>
    handled.mutate({ emailId: email.id, handled: value });
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Suggested reply
        </h4>
        {done ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-ink">
            <CheckIcon aria-hidden className="size-3.5" />
            Replied
          </span>
        ) : email.replyNeeded ? (
          <span className="text-xs font-medium text-warning-ink">
            They&apos;re waiting for your answer
          </span>
        ) : null}
      </div>
      <p className="text-sm whitespace-pre-wrap">{email.reply.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          text={email.reply.body}
          label="Copy reply"
          variant={done ? "outline" : "default"}
          context={email.subject ?? undefined}
          onCopied={() => {
            if (!done) mark(true);
          }}
        />
        {done ? (
          <Button variant="ghost" size="sm" onClick={() => mark(false)}>
            Not sent yet
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => mark(true)}>
            <CheckIcon aria-hidden data-icon="inline-start" />
            Mark as replied
          </Button>
        )}
      </div>
      {handled.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {handled.error.message}
        </p>
      ) : null}
    </div>
  );
}

function DeleteButton({ emailId }: { emailId: string }) {
  const remove = useDeleteEmail();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setAsking(true)}
      >
        <Trash2Icon aria-hidden data-icon="inline-start" />
        Delete
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      Delete this email?
      <Button
        variant="destructive"
        size="sm"
        disabled={remove.isPending}
        onClick={() => remove.mutate(emailId)}
      >
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Keep
      </Button>
      {remove.isError ? (
        <span role="alert" className="text-xs text-destructive">
          {remove.error.message}
        </span>
      ) : null}
    </span>
  );
}

/** The role an email was filed under, on the Applications page. */
function FiledUnder({ job }: { job: NonNullable<FiledEmailView["job"]> }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Filed under</span>
      <Link
        href={roleHref(job)}
        className="font-medium underline-offset-4 hover:underline"
      >
        {job.title} at {job.company}
      </Link>
      <StatusPill status={job.status} />
    </p>
  );
}

export function EmailCard({
  email,
  job,
  replyAtTop = false,
  onCollapse,
  children,
}: {
  email: PastedEmailView;
  /** On the Applications page: the role it was filed under. */
  job?: FiledEmailView["job"];
  /**
   * On the application's page, which shows the reply it's waiting for at
   * the top: a link up to it in place of the reply.
   */
  replyAtTop?: boolean;
  /** Folds the card back into its row in a conversation. */
  onCollapse?: () => void;
  /** Below the reading, such as the picker for an email with no role. */
  children?: React.ReactNode;
}) {
  const retry = useRetryEmail();
  const title =
    [email.senderName, email.subject].filter(Boolean).join(" · ") ||
    "Pasted email";

  return (
    <article
      aria-label={email.status === "done" ? emailLabel(email) : "Pasted email"}
      className="@container flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {email.status === "done" ? <EmailTag email={email} /> : null}
        {/* On a narrow card, a line of its own below the kind and a shorter date. */}
        <span className="min-w-0 grow basis-40 truncate text-sm font-medium @max-md:order-last @max-md:basis-full">
          {email.status === "done" ? title : "Pasted email"}
        </span>
        <RelativeDate
          iso={email.pastedAt}
          kind="found"
          className="ml-auto text-xs text-muted-foreground @max-md:hidden"
        />
        <RelativeDate
          iso={email.pastedAt}
          kind="date"
          className="ml-auto text-xs text-muted-foreground @md:hidden"
        />
        {onCollapse ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-my-1 -mr-1 text-muted-foreground"
            aria-expanded
            onClick={onCollapse}
          >
            <ChevronUpIcon aria-hidden />
            <span className="sr-only">Fold this email</span>
          </Button>
        ) : null}
      </header>

      {email.status === "reading" ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden />
          {email.jobId
            ? "Reading the email and writing a reply…"
            : "Reading the email and finding its application…"}
        </p>
      ) : null}

      {email.status === "failed" ? (
        <div className="flex flex-col gap-2">
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {email.error ?? "Couldn't read this email."}
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending}
              onClick={() => retry.mutate(email.id)}
            >
              <RotateCcwIcon aria-hidden data-icon="inline-start" />
              Try again
            </Button>
          </div>
          {retry.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {retry.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {email.status === "done" ? (
        <>
          {job ? <FiledUnder job={job} /> : null}
          <Effect email={email} jobId={email.jobId} />
          {email.summary ? <p className="text-sm">{email.summary}</p> : null}
          {email.keyPoints.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {email.keyPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          ) : null}
          {replyAtTop ? (
            <a
              href="#now"
              className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-warning-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ArrowUpIcon aria-hidden className="size-4" />
              Your reply is ready at the top
            </a>
          ) : (
            <Reply email={email} />
          )}
        </>
      ) : null}

      {children}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <details className="group min-w-0 flex-1 text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
            Show the email
          </summary>
          <p className="mt-2 max-h-80 overflow-y-auto rounded-lg bg-muted/40 p-3 text-[0.8125rem] break-words whitespace-pre-wrap">
            {email.body}
          </p>
        </details>
        <DeleteButton emailId={email.id} />
      </footer>
    </article>
  );
}
