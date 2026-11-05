"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";

import { EmailCard, EmailTag } from "@/components/emails/email-card";
import { emailLabel } from "@/components/emails/labels";
import { PasteEmail } from "@/components/emails/paste-email";
import { documentList } from "@/components/jobs/event-labels";
import { STATUS_LABELS } from "@/components/jobs/labels";
import { LocalDate } from "@/components/jobs/local-date";
import { RelativeDate } from "@/components/jobs/relative-date";
import type { ConversationItem } from "@/lib/applications/progress";
import type { PastedEmailView } from "@/lib/dal/emails";
import type { JobStatus } from "@/lib/schemas/tracker";
import { cn } from "@/lib/utils";

import { APPLICATION_DAY, initials } from "./labels";

// The back and forth with the company, oldest first: the application, each
// email pasted into the role, and what they did to its status. Emails fold
// into one line each; the newest is open, as are ones being read.

type Item = ConversationItem<PastedEmailView>;

/** What a kind of email is, in "by Lena's invite". Others are an email. */
const EMAIL_NOUNS: Partial<
  Record<NonNullable<PastedEmailView["outcome"]>, string>
> = {
  interview: "invite",
  assessment: "task",
};

function Avatar({
  email,
  company,
  ownerInitial,
}: {
  email: PastedEmailView;
  company: string;
  ownerInitial: string;
}) {
  const yours = email.author === "candidate";
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-8 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold ring-4 ring-background",
        yours
          ? "bg-primary-soft text-primary-ink"
          : "bg-neutral-soft text-muted-foreground",
      )}
    >
      {yours ? ownerInitial : initials(email.senderName?.trim() || company)}
    </span>
  );
}

/** A small round icon on the line, for the application and status moves. */
function Marker({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="relative grid h-7.5 w-8 shrink-0 place-items-center"
    >
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full ring-4 ring-background [&_svg]:size-3.5",
          className,
        )}
      >
        {children}
      </span>
    </span>
  );
}

/** The soft fill and ink of a status, for its move on the line. */
const MOVE_LOOKS: Partial<Record<JobStatus, string>> = {
  applied: "bg-status-applied-soft text-status-applied-ink",
  interviewing: "bg-status-interviewing-soft text-status-interviewing-ink",
  offer: "bg-status-offer-soft text-status-offer-ink",
  rejected: "bg-destructive-soft text-destructive-ink",
};

function Line({
  marker,
  children,
  at,
}: {
  marker: React.ReactNode;
  children: React.ReactNode;
  at: string;
}) {
  return (
    <>
      {marker}
      <p className="flex min-h-7.5 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.8125rem]">
        <span className="min-w-0">{children}</span>
        <LocalDate
          iso={at}
          format={APPLICATION_DAY}
          className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        />
      </p>
    </>
  );
}

function StatusLine({
  item,
  company,
}: {
  item: Extract<Item, { kind: "status" }>;
  company: string;
}) {
  const { to, source, reason } = item.change;
  const email = item.email;
  const why =
    source === "email"
      ? email
        ? ` by ${email.author === "candidate" ? "your" : `${email.senderName?.trim() || company}'s`} ${(email.outcome && EMAIL_NOUNS[email.outcome]) ?? "email"}`
        : " by an email"
      : source === "no_reply"
        ? ` by the app. ${reason ?? ""}`.trimEnd()
        : reason
          ? `. ${reason}`
          : "";
  return (
    <Line
      at={item.at}
      marker={
        <Marker
          className={MOVE_LOOKS[to] ?? "bg-neutral-soft text-muted-foreground"}
        >
          <ArrowRightIcon />
        </Marker>
      }
    >
      <strong className="font-semibold">
        {source === "email" || source === "no_reply"
          ? `Moved to ${STATUS_LABELS[to]}`
          : `You moved it to ${STATUS_LABELS[to]}`}
      </strong>
      <span className="text-muted-foreground">{why}</span>
    </Line>
  );
}

/** One email folded into a line: who, what kind, what it says, when. */
function EmailRow({
  email,
  company,
  ownerInitial,
  onOpen,
}: {
  email: PastedEmailView;
  company: string;
  ownerInitial: string;
  onOpen: () => void;
}) {
  const yours = email.author === "candidate";
  const name = yours ? "You" : email.senderName?.trim() || company;
  return (
    <>
      <Avatar email={email} company={company} ownerInitial={ownerInitial} />
      <button
        type="button"
        id={`email-row-${email.id}`}
        aria-expanded={false}
        onClick={onOpen}
        className={cn(
          // Where the conversation is narrow, who and when on one line, then what
          // it is and says.
          "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-xl border px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 @xl:flex",
          yours ? "border-primary/25 bg-primary-soft/40" : "bg-card",
        )}
      >
        <span className="min-w-0 truncate text-[0.8125rem] font-semibold @xl:max-w-1/3 @xl:shrink-0">
          {name}
        </span>
        <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2.5 @xl:flex-1">
          <EmailTag email={email} />
          <span className="min-w-0 truncate text-[0.8125rem] text-muted-foreground">
            {email.summary ?? emailLabel(email)}
          </span>
        </span>
        <span className="col-start-2 row-start-1 flex shrink-0 items-center gap-2.5">
          {email.handledAt ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-ink">
              <CheckIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
              <span className="@max-xl:sr-only">Replied</span>
            </span>
          ) : null}
          <RelativeDate
            iso={email.pastedAt}
            kind="date"
            className="text-xs text-muted-foreground tabular-nums"
          />
          <ChevronDownIcon
            aria-hidden
            className="size-4 text-muted-foreground"
          />
        </span>
        <span className="sr-only">Open this email</span>
      </button>
    </>
  );
}

export function Conversation({
  jobId,
  company,
  items,
  replyAtTop,
  ownerInitial,
}: {
  jobId: string;
  company: string;
  items: Item[];
  /** The email whose reply the card at the top shows. */
  replyAtTop: string | null;
  ownerInitial: string;
}) {
  const emails = items.flatMap((item) =>
    item.kind === "email" ? [item.email] : [],
  );
  const newest = emails.at(-1);
  // What the owner opened or folded, over what's open by default: emails
  // still being read, and the newest one unless the card at the top already
  // shows all of it.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (email: PastedEmailView) =>
    toggled[email.id] ??
    (email.status !== "done" ||
      (email.id === newest?.id &&
        (email.id !== replyAtTop || email.moved?.undo === true)));
  const toggle = (email: PastedEmailView) => {
    const open = !isOpen(email);
    flushSync(() => setToggled((now) => ({ ...now, [email.id]: open })));
    document
      .getElementById(open ? `email-${email.id}` : `email-row-${email.id}`)
      ?.focus();
  };

  return (
    <section
      aria-labelledby="conversation-heading"
      className="@container flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2
          id="conversation-heading"
          className="text-lg font-semibold tracking-tight"
        >
          The conversation
        </h2>
        <span className="text-[0.8125rem] text-muted-foreground">
          {emails.length === 0
            ? "No emails yet"
            : `${emails.length} ${emails.length === 1 ? "email" : "emails"}, oldest first`}
        </span>
      </div>

      <ol aria-label="The conversation, oldest first" className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.key}
            className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 pb-3 before:absolute before:top-2 before:bottom-0 before:left-4 before:w-px before:bg-border"
          >
            {item.kind === "applied" ? (
              <Line
                at={item.at}
                marker={
                  <Marker className="bg-status-applied-soft text-status-applied-ink">
                    <SendIcon />
                  </Marker>
                }
              >
                <strong className="font-semibold">You applied</strong>
                {item.documents.length > 0 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    with {documentList(item.documents)}
                  </span>
                ) : null}
              </Line>
            ) : item.kind === "status" ? (
              <StatusLine item={item} company={company} />
            ) : isOpen(item.email) ? (
              <>
                <Avatar
                  email={item.email}
                  company={company}
                  ownerInitial={ownerInitial}
                />
                <div
                  id={`email-${item.email.id}`}
                  tabIndex={-1}
                  className="min-w-0 rounded-xl outline-none"
                >
                  <EmailCard
                    email={item.email}
                    replyAtTop={item.email.id === replyAtTop}
                    onCollapse={
                      item.email.status === "done"
                        ? () => toggle(item.email)
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <EmailRow
                email={item.email}
                company={company}
                ownerInitial={ownerInitial}
                onOpen={() => toggle(item.email)}
              />
            )}
          </li>
        ))}
        <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-full border-[1.5px] border-dashed bg-background text-muted-foreground"
          >
            <PlusIcon className="size-4" />
          </span>
          <div className="rounded-xl border bg-card p-3.5 shadow-xs sm:p-4">
            <PasteEmail
              jobId={jobId}
              label={
                emails.length > 0
                  ? `Got another email from ${company}?`
                  : `Paste an email from ${company}`
              }
              hint="Claude sums it up, moves the role on and writes your reply. Paste the replies you send too."
            />
          </div>
        </li>
      </ol>
    </section>
  );
}
