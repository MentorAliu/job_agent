"use client";

import {
  CalendarIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClockIcon,
  ReplyIcon,
} from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { useEmailHandled } from "@/components/emails/use-email-actions";
import { LocalDate } from "@/components/jobs/local-date";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ApplicationNow } from "@/lib/applications/progress";
import type { PastedEmailView } from "@/lib/dal/emails";
import { NO_RESPONSE_DAYS } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";
import { cn } from "@/lib/utils";

import { APPLICATION_DAY } from "./labels";

// The top of an application's page: the one thing that's the owner's to do,
// or that nothing is and why. When the company waits for an answer, the
// reply Claude wrote is right here to copy.

type Tone = "turn" | "offer" | "quiet" | "closed";

const TONES: Record<Tone, { card: string; strip: string }> = {
  turn: {
    card: "border-warning/45",
    strip: "bg-warning-soft text-warning-ink",
  },
  offer: {
    card: "border-status-offer/45",
    strip: "bg-status-offer-soft text-status-offer-ink",
  },
  quiet: { card: "", strip: "bg-muted/60 text-muted-foreground" },
  closed: {
    card: "",
    strip: "bg-destructive-soft text-destructive-ink",
  },
};

/** Whoever signed the email, or the company when it isn't signed. */
const signedBy = (email: PastedEmailView | null, company: string) =>
  email?.senderName?.trim() || company;

function Frame({
  tone,
  icon,
  label,
  detail,
  sentence = false,
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  /** After the label, such as when it happened. */
  detail: React.ReactNode;
  /** The detail is a sentence of its own, not a date after a dot. */
  sentence?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id="now"
      aria-labelledby="now-heading"
      className={cn(
        "scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-xs",
        TONES[tone].card,
      )}
    >
      <p
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-[0.8125rem] sm:px-5 [&_svg]:size-4 [&_svg]:shrink-0",
          TONES[tone].strip,
        )}
      >
        {icon}
        <strong className="font-semibold">{label}</strong>
        {detail ? (
          <span>
            {sentence ? null : "· "}
            {detail}
          </span>
        ) : null}
      </p>
      <div className="flex flex-col gap-3.5 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 id="now-heading" className="text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );
}

/** The email's key points, as chips. */
function KeyPoints({ points }: { points: string[] }) {
  if (points.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {points.map((point, index) => (
        <li
          key={index}
          className="inline-flex max-w-full items-start gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[0.8125rem]"
        >
          {index === 0 ? (
            <CalendarIcon
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
          {point}
        </li>
      ))}
    </ul>
  );
}

export function NowCard({
  now,
  status,
  company,
}: {
  now: ApplicationNow<PastedEmailView>;
  status: JobStatus;
  company: string;
}) {
  switch (now.kind) {
    case "reply":
      return (
        <ReplyNow
          email={now.email}
          offer={status === "offer"}
          company={company}
        />
      );
    case "offer":
      return (
        <Frame
          tone="offer"
          icon={<CircleCheckIcon aria-hidden />}
          label="Offer"
          detail={
            now.since ? (
              <LocalDate iso={now.since} format={APPLICATION_DAY} />
            ) : null
          }
        >
          <Heading>{company} made you an offer</Heading>
          {now.email?.keyPoints.length ? (
            <KeyPoints points={now.email.keyPoints} />
          ) : now.email?.summary ? (
            <p className="text-sm text-pretty">{now.email.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Paste their email to get its details and a reply.
            </p>
          )}
        </Frame>
      );
    case "waiting":
      return <Waiting now={now} status={status} company={company} />;
    case "closed":
      return <Closed now={now} company={company} />;
  }
}

/** The company waits for an answer: what they said, and the reply to send. */
function ReplyNow({
  email,
  offer,
  company,
}: {
  email: PastedEmailView;
  /** The role is at Offer. */
  offer: boolean;
  company: string;
}) {
  const handled = useEmailHandled();
  const who = signedBy(email, company);
  // Marking it moves this card on to waiting at once, and callbacks passed
  // to mutate() don't run once it's gone, so the toasts hang off the promise.
  const markReplied = (copied: boolean) => {
    handled
      .mutateAsync({ emailId: email.id, handled: true })
      .then(() =>
        toast.add({
          title: copied ? "Reply copied" : "Marked as replied",
          description: copied
            ? `Paste it into your email to ${who}. The role now waits on them.`
            : `The role now waits on ${company}.`,
          type: "success",
          actionProps: {
            children: "Undo",
            onClick: () =>
              handled.mutate({ emailId: email.id, handled: false }),
          },
        }),
      )
      .catch((error: unknown) =>
        toast.add({
          title: "Couldn't mark it as replied",
          description:
            error instanceof Error ? error.message : "Try again in a moment.",
          type: "error",
        }),
      );
  };

  return (
    <Frame
      tone={offer ? "offer" : "turn"}
      icon={<ReplyIcon aria-hidden />}
      label={offer ? "Offer, your turn" : "Your turn"}
      sentence
      detail={
        <>
          {who} has been waiting for your answer since{" "}
          <LocalDate iso={email.pastedAt} format={APPLICATION_DAY} />
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <Heading>
          {offer && email.outcome === "offer"
            ? `${company} made you an offer`
            : `Reply to ${who}`}
        </Heading>
        {email.summary ? (
          <p className="text-sm text-pretty text-foreground/85">
            {email.summary}
          </p>
        ) : null}
      </div>
      <KeyPoints points={email.keyPoints} />
      {email.reply ? (
        <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3.5 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Suggested reply
            </h3>
            {email.reply.subject ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {email.reply.subject}
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {email.reply.body}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              text={email.reply.body}
              label="Copy reply"
              variant="default"
              context={email.subject ?? undefined}
              onCopied={() => markReplied(true)}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={handled.isPending}
              onClick={() => markReplied(false)}
            >
              <CheckIcon aria-hidden data-icon="inline-start" />
              Mark as replied
            </Button>
            <span className="text-xs text-muted-foreground">
              Copying it counts as replied.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="outline"
            size="sm"
            disabled={handled.isPending}
            onClick={() => markReplied(false)}
          >
            <CheckIcon aria-hidden data-icon="inline-start" />
            Mark as replied
          </Button>
          <span className="text-xs text-muted-foreground">
            Claude didn&apos;t write a reply for this one.
          </span>
        </div>
      )}
    </Frame>
  );
}

const AFTER_LABELS = {
  applied: "applied",
  they_wrote: "wrote",
  you_replied: "you replied",
} as const;

/** The company's move: what they last said, and when the app closes it. */
function Waiting({
  now,
  status,
  company,
}: {
  now: Extract<ApplicationNow<PastedEmailView>, { kind: "waiting" }>;
  status: JobStatus;
  company: string;
}) {
  const theirs = now.email;
  const who = signedBy(theirs, company);
  const comingUp =
    theirs !== null &&
    theirs.keyPoints.length > 0 &&
    (theirs.outcome === "interview" || theirs.outcome === "assessment");
  return (
    <Frame
      tone="quiet"
      icon={<ClockIcon aria-hidden />}
      label="Waiting on them"
      detail={
        now.since ? (
          <>
            {now.after === "they_wrote" ? `${who} ` : null}
            {AFTER_LABELS[now.after]}{" "}
            <LocalDate iso={now.since} format={APPLICATION_DAY} />
          </>
        ) : null
      }
    >
      {comingUp ? (
        <>
          <Heading>Coming up, from {who}&apos;s last email</Heading>
          <KeyPoints points={theirs.keyPoints} />
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <Heading>Nothing to do yet</Heading>
          <p className="text-sm text-pretty text-foreground/85">
            {theirs?.summary ||
              (theirs
                ? `${company} wrote. Paste their next email when it comes.`
                : `${company} hasn't written yet.`)}
          </p>
          {theirs && theirs.keyPoints.length > 0 ? (
            <div className="mt-2.5">
              <KeyPoints points={theirs.keyPoints} />
            </div>
          ) : null}
        </div>
      )}
      {now.closesAt && status === "applied" ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          If they stay quiet until{" "}
          <LocalDate iso={now.closesAt} format={APPLICATION_DAY} />, the app
          moves the role to No response by itself.
        </p>
      ) : null}
    </Frame>
  );
}

/**
 * How the application ended. When an email ended it, its card in the
 * conversation has the Undo.
 */
function Closed({
  now,
  company,
}: {
  now: Extract<ApplicationNow<PastedEmailView>, { kind: "closed" }>;
  company: string;
}) {
  const when = now.since ? (
    <LocalDate iso={now.since} format={APPLICATION_DAY} />
  ) : null;
  const icon =
    now.status === "rejected" ? (
      <CircleXIcon aria-hidden />
    ) : (
      <CircleMinusIcon aria-hidden />
    );
  if (now.status === "rejected") {
    return (
      <Frame tone="closed" icon={icon} label="Closed" detail={when}>
        <div className="flex flex-col gap-1">
          <Heading>{company} isn&apos;t going ahead</Heading>
          <p className="text-sm text-pretty text-foreground/85">
            {now.email?.summary ? `${now.email.summary} ` : null}
            Nothing to do.
          </p>
        </div>
      </Frame>
    );
  }
  if (now.status === "no_response") {
    const byApp = now.source === "no_reply";
    return (
      <Frame tone="quiet" icon={icon} label="Closed" detail={when}>
        <div className="flex flex-col gap-1">
          <Heading>
            {byApp ? `No answer in ${NO_RESPONSE_DAYS} days` : "No answer"}
          </Heading>
          <p className="text-sm text-pretty text-foreground/85">
            {byApp ? "The app" : "You"} closed it
            {when ? <> on {when}</> : null}. If {company} writes after all,
            paste the email and the role opens again.
          </p>
        </div>
      </Frame>
    );
  }
  return (
    <Frame tone="quiet" icon={icon} label="Closed" detail={when}>
      <div className="flex flex-col gap-1">
        <Heading>You withdrew</Heading>
        <p className="text-sm text-pretty text-foreground/85">
          Nothing to do. If that was a mistake, change the status from the menu
          at the top.
        </p>
      </div>
    </Frame>
  );
}
