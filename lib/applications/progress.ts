// An application's own page (`/applications/[id]`): how far it got, what's
// the owner's to do now, and the conversation with the company, worked out
// from the role's status, its emails and its timeline. Emails and events
// come newest first, as the data access layer gives them.
import type { SentDocument } from "@/lib/dal/apply-kit";
import type { PastedEmailView } from "@/lib/dal/emails";
import type { TimelineEvent } from "@/lib/dal/jobs";
import { APPLIED_STATUSES } from "@/lib/mail/rules";
import { NO_RESPONSE_DAYS } from "@/lib/schemas/mail";
import {
  BEFORE_APPLYING,
  type JobEvent,
  type JobStatus,
  type StatusSource,
} from "@/lib/schemas/tracker";

import { CLOSED_APPLICATION_STATUSES } from "./params";

/** What these functions read of a pasted email. */
export type EmailFacts = Pick<
  PastedEmailView,
  | "id"
  | "status"
  | "author"
  | "outcome"
  | "replyNeeded"
  | "handledAt"
  | "pastedAt"
  | "keyPoints"
>;

export type ClosedStatus = (typeof CLOSED_APPLICATION_STATUSES)[number];

type StatusChange = Extract<JobEvent, { type: "status_changed" }>["payload"];
type StatusChangeEvent = Extract<TimelineEvent, { type: "status_changed" }>;

/** A role the owner applied to, which has its own application page. */
export function isApplied(status: JobStatus): boolean {
  return (APPLIED_STATUSES as readonly JobStatus[]).includes(status);
}

/** A role's page: its application once applied to, its apply kit before. */
export function roleHref(job: { id: string; status: JobStatus }): string {
  return isApplied(job.status) ? `/applications/${job.id}` : `/jobs/${job.id}`;
}

function isClosed(status: JobStatus): status is ClosedStatus {
  return (CLOSED_APPLICATION_STATUSES as readonly JobStatus[]).includes(status);
}

/** Emails that count: read, and about this application. */
function readEmails<E extends EmailFacts>(emails: readonly E[]): E[] {
  return emails.filter(
    (email) => email.status === "done" && email.outcome !== "unrelated",
  );
}

const isStatusChange = (event: TimelineEvent): event is StatusChangeEvent =>
  event.type === "status_changed";

/** The latest move to `status`, which is the one still in effect. */
function latestMoveTo(
  events: readonly TimelineEvent[],
  status: JobStatus,
): StatusChangeEvent | null {
  return (
    events
      .filter(isStatusChange)
      .find((event) => event.payload.to === status) ?? null
  );
}

function emailById<E extends EmailFacts>(
  emails: readonly E[],
  id: string | undefined,
): E | null {
  return (id && emails.find((email) => email.id === id)) || null;
}

type Application<E> = {
  status: JobStatus;
  appliedAt: string | null;
  emails: readonly E[];
  events: readonly TimelineEvent[];
};

// ---------------------------------------------------------------------------
// How far it got
// ---------------------------------------------------------------------------

const PATH = ["applied", "replied", "interviewing", "offer"] as const;

export type StepKey = (typeof PATH)[number] | ClosedStatus;

export type ApplicationStep = {
  key: StepKey;
  state: "done" | "now" | "todo";
  /** When it got there, if it did and the app knows. */
  at: string | null;
};

/**
 * Applied, They replied, Interviewing and Offer, up to where the role is. A
 * closed role keeps the steps it reached and ends on how it closed.
 */
export function applicationSteps<E extends EmailFacts>({
  status,
  appliedAt,
  emails,
  events,
}: Application<E>): ApplicationStep[] {
  const closing = isClosed(status) ? latestMoveTo(events, status) : null;
  // The email that closed it isn't them replying, as far as the steps go.
  const replies = readEmails(emails).filter(
    (email) =>
      email.author === "employer" && email.id !== closing?.payload.emailId,
  );
  const reached = isClosed(status)
    ? (closing?.payload.from ?? "applied")
    : status;
  const level =
    reached === "offer"
      ? 3
      : reached === "interviewing"
        ? 2
        : replies.length > 0
          ? 1
          : 0;
  const at: Record<(typeof PATH)[number], string | null> = {
    applied: appliedAt,
    replied: replies.at(-1)?.pastedAt ?? null,
    interviewing: latestMoveTo(events, "interviewing")?.at ?? null,
    offer: latestMoveTo(events, "offer")?.at ?? null,
  };

  if (isClosed(status)) {
    return [
      ...PATH.slice(0, level + 1).map((key): ApplicationStep => ({
        key,
        state: "done",
        at: at[key],
      })),
      { key: status, state: "now", at: closing?.at ?? null },
    ];
  }
  return PATH.map((key, index) => ({
    key,
    state: index < level ? "done" : index === level ? "now" : "todo",
    at: index <= level ? at[key] : null,
  }));
}

// ---------------------------------------------------------------------------
// What's the owner's to do now
// ---------------------------------------------------------------------------

export type ApplicationNow<E> =
  /** The company's latest email waits for the owner's answer. */
  | { kind: "reply"; email: E }
  /** An offer the owner has answered, or that asks nothing yet. */
  | { kind: "offer"; email: E | null; since: string | null }
  /** The company's move. */
  | {
      kind: "waiting";
      /** What happened last: the application, their email, or the owner's answer. */
      after: "applied" | "they_wrote" | "you_replied";
      since: string | null;
      /** The company's latest email, for what it said is coming up. */
      email: E | null;
      /**
       * When the daily check moves the role to No response if the company
       * stays quiet. Only applied roles move.
       */
      closesAt: string | null;
    }
  | {
      kind: "closed";
      status: ClosedStatus;
      since: string | null;
      source: StatusSource | null;
      /** The email that closed it, when one did. */
      email: E | null;
    };

/**
 * When the daily check would move an applied role to No response: once
 * NO_RESPONSE_DAYS pass after applying and after the company's last email.
 */
function closesAt(
  appliedAt: string | null,
  theirs: EmailFacts | null,
): string | null {
  const times = [appliedAt, theirs?.pastedAt]
    .filter((time): time is string => Boolean(time))
    .map((time) => Date.parse(time));
  if (times.length === 0) return null;
  return new Date(Math.max(...times) + NO_RESPONSE_DAYS * 864e5).toISOString();
}

/**
 * The one thing the page leads with. It's the owner's turn when the
 * company's latest email waits for a reply they haven't sent, as on the
 * Applications page.
 */
export function applicationNow<E extends EmailFacts>({
  status,
  appliedAt,
  emails,
  events,
}: Application<E>): ApplicationNow<E> {
  if (isClosed(status)) {
    const move = latestMoveTo(events, status);
    return {
      kind: "closed",
      status,
      since: move?.at ?? null,
      source: move?.payload.source ?? null,
      email: emailById(emails, move?.payload.emailId),
    };
  }

  const read = readEmails(emails);
  const latest = read[0] ?? null;
  if (
    latest?.author === "employer" &&
    latest.replyNeeded &&
    latest.handledAt === null
  ) {
    return { kind: "reply", email: latest };
  }

  const theirs = read.find((email) => email.author === "employer") ?? null;
  if (status === "offer") {
    const move = latestMoveTo(events, "offer");
    return {
      kind: "offer",
      email:
        emailById(read, move?.payload.emailId) ??
        read.find(
          (email) => email.author === "employer" && email.outcome === "offer",
        ) ??
        null,
      since: move?.at ?? null,
    };
  }

  const after = !latest
    ? "applied"
    : latest.author === "candidate" || latest.handledAt !== null
      ? "you_replied"
      : "they_wrote";
  return {
    kind: "waiting",
    after,
    since:
      after === "applied"
        ? appliedAt
        : after === "you_replied" && latest?.author === "employer"
          ? latest.handledAt
          : (latest?.pastedAt ?? null),
    email: theirs,
    closesAt: status === "applied" ? closesAt(appliedAt, theirs) : null,
  };
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

export type ConversationItem<E> =
  | { kind: "applied"; key: string; at: string; documents: SentDocument[] }
  | { kind: "email"; key: string; at: string; email: E }
  | {
      kind: "status";
      key: string;
      at: string;
      change: StatusChange;
      /** The email that made the change, while it's still there. */
      email: E | null;
    };

const ITEM_ORDER: Record<ConversationItem<unknown>["kind"], number> = {
  applied: 0,
  email: 1,
  status: 2,
};

/**
 * The application, every email pasted into the role, and the status moves
 * since applying, oldest first. Getting the kit ready and sending it is the
 * kit's story, so it's left out.
 */
export function conversationItems<E extends EmailFacts>({
  appliedAt,
  documents,
  emails,
  events,
}: {
  appliedAt: string | null;
  documents: SentDocument[];
  emails: readonly E[];
  events: readonly TimelineEvent[];
}): ConversationItem<E>[] {
  const items: ConversationItem<E>[] = [
    ...(appliedAt
      ? [{ kind: "applied" as const, key: "applied", at: appliedAt, documents }]
      : []),
    ...emails.map((email) => ({
      kind: "email" as const,
      key: email.id,
      at: email.pastedAt,
      email,
    })),
    ...events
      .filter(isStatusChange)
      .filter(
        (event) =>
          !BEFORE_APPLYING.includes(event.payload.from) &&
          (!appliedAt || event.at >= appliedAt),
      )
      .map((event) => ({
        kind: "status" as const,
        key: event.id,
        at: event.at,
        change: event.payload,
        email: emailById(emails, event.payload.emailId),
      })),
  ];
  return items.sort(
    (a, b) =>
      a.at.localeCompare(b.at) || ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind],
  );
}

/** The people at the company who wrote, by name, newest first, with how many emails each. */
export function peopleWhoWrote<
  E extends EmailFacts & Pick<PastedEmailView, "senderName">,
>(emails: readonly E[], company: string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const email of readEmails(emails)) {
    if (email.author !== "employer") continue;
    const name = email.senderName?.trim() || company;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}
