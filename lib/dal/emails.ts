import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { event, job, jobEmail } from "@/db/schema";
import { APPLIED_STATUSES } from "@/lib/mail/rules";
import {
  READING_STALE_MS,
  type EmailAuthor,
  type EmailReadStatus,
  type MailOutcome,
  type PasteEmailInput,
  type SuggestedReply,
} from "@/lib/schemas/mail";
import { jobEventSchema, type JobStatus } from "@/lib/schemas/tracker";

import { db } from "./db";
import { JobNotFoundError } from "./jobs";
import { getCurrentUser } from "./session";

// Emails the owner pastes: into a role, or on the Applications page, where
// the app finds the role. Claude reads each one in an Inngest step
// (inngest/read-email.ts); these are the owner's reads and writes.

/** How long an email pasted on the Applications page stays listed there. */
const RECENT_PASTE_MS = 24 * 3600e3;

const STALE_MESSAGE = "Reading this email didn't finish. Try again.";

export type PastedEmailView = {
  id: string;
  jobId: string | null;
  status: EmailReadStatus;
  error: string | null;
  author: EmailAuthor | null;
  outcome: MailOutcome | null;
  sure: boolean | null;
  quote: string | null;
  senderName: string | null;
  subject: string | null;
  summary: string | null;
  keyPoints: string[];
  replyNeeded: boolean;
  reply: SuggestedReply | null;
  handledAt: string | null;
  /** The text as pasted. */
  body: string;
  pastedAt: string;
  /**
   * The status this email moved its role to. `undo` is set while that's
   * still the role's latest change, so it can be taken back.
   */
  moved: { from: JobStatus; to: JobStatus; undo: boolean } | null;
};

/** A pasted email with the role it was filed under, for the Applications page. */
export type FiledEmailView = PastedEmailView & {
  job: { id: string; title: string; company: string; status: JobStatus } | null;
};

export class EmailNotFoundError extends Error {
  constructor() {
    super("That email is no longer here.");
    this.name = "EmailNotFoundError";
  }
}

const emailColumns = {
  id: jobEmail.id,
  jobId: jobEmail.jobId,
  status: jobEmail.status,
  error: jobEmail.error,
  author: jobEmail.author,
  outcome: jobEmail.outcome,
  sure: jobEmail.sure,
  quote: jobEmail.quote,
  senderName: jobEmail.senderName,
  subject: jobEmail.subject,
  summary: jobEmail.summary,
  keyPoints: jobEmail.keyPoints,
  replyNeeded: jobEmail.replyNeeded,
  reply: jobEmail.reply,
  handledAt: jobEmail.handledAt,
  body: jobEmail.body,
  queuedAt: jobEmail.queuedAt,
  createdAt: jobEmail.createdAt,
};

type EmailRow = Pick<typeof jobEmail.$inferSelect, keyof typeof emailColumns>;

/**
 * The status changes these emails made, and whether each is still its
 * role's latest change with the role at that status.
 */
async function statusMoves(
  rows: { id: string; jobId: string | null }[],
): Promise<Map<string, NonNullable<PastedEmailView["moved"]>>> {
  const jobIds = [
    ...new Set(rows.flatMap((row) => (row.jobId ? [row.jobId] : []))),
  ];
  const moves = new Map<string, NonNullable<PastedEmailView["moved"]>>();
  if (jobIds.length === 0) return moves;
  const changes = await db
    .select({
      jobId: event.jobId,
      type: event.type,
      payload: event.payload,
      status: job.status,
      latest: sql<boolean>`${event.at} = max(${event.at}) over (partition by ${event.jobId})`,
    })
    .from(event)
    .innerJoin(job, eq(job.id, event.jobId))
    .where(and(inArray(event.jobId, jobIds), eq(event.type, "status_changed")));
  for (const change of changes) {
    const parsed = jobEventSchema.safeParse(change);
    if (parsed.data?.type !== "status_changed") continue;
    const { emailId, from, to } = parsed.data.payload;
    if (!emailId) continue;
    moves.set(emailId, {
      from,
      to,
      undo: change.latest && change.status === to,
    });
  }
  return moves;
}

/** A read that started long ago and never finished. */
const isStale = (
  row: Pick<EmailRow, "status" | "queuedAt">,
  now = Date.now(),
) =>
  row.status === "reading" && row.queuedAt.getTime() < now - READING_STALE_MS;

function toView(
  row: EmailRow,
  moves: Map<string, NonNullable<PastedEmailView["moved"]>>,
): PastedEmailView {
  const stale = isStale(row);
  return {
    id: row.id,
    jobId: row.jobId,
    status: stale ? "failed" : row.status,
    error: stale ? STALE_MESSAGE : row.error,
    author: row.author,
    outcome: row.outcome,
    sure: row.sure,
    quote: row.quote,
    senderName: row.senderName,
    subject: row.subject,
    summary: row.summary,
    keyPoints: row.keyPoints ?? [],
    replyNeeded: row.replyNeeded,
    reply: row.reply,
    handledAt: row.handledAt?.toISOString() ?? null,
    body: row.body,
    pastedAt: row.createdAt.toISOString(),
    moved: moves.get(row.id) ?? null,
  };
}

/** The emails pasted into one role, newest first. */
export async function getRoleEmails(jobId: string): Promise<PastedEmailView[]> {
  await getCurrentUser();
  const rows = await db
    .select(emailColumns)
    .from(jobEmail)
    .where(eq(jobEmail.jobId, jobId))
    .orderBy(desc(jobEmail.createdAt));
  const moves = await statusMoves(rows);
  return rows.map((row) => toView(row, moves));
}

/**
 * The Applications page's pasted emails, newest first: those the app is
 * still reading or couldn't place, and those it filed in the last day.
 */
export async function getPastedEmails(
  now = new Date(),
): Promise<FiledEmailView[]> {
  await getCurrentUser();
  const rows = await db
    .select({
      ...emailColumns,
      title: job.title,
      company: job.company,
      jobStatus: job.status,
    })
    .from(jobEmail)
    .leftJoin(job, eq(job.id, jobEmail.jobId))
    .where(
      or(
        isNull(jobEmail.jobId),
        and(
          eq(jobEmail.autoFiled, true),
          gte(jobEmail.createdAt, new Date(now.getTime() - RECENT_PASTE_MS)),
        ),
      ),
    )
    .orderBy(desc(jobEmail.createdAt))
    .limit(20);
  const moves = await statusMoves(rows);
  return rows.map((row) => ({
    ...toView(row, moves),
    job:
      row.jobId && row.title && row.company && row.jobStatus
        ? {
            id: row.jobId,
            title: row.title,
            company: row.company,
            status: row.jobStatus,
          }
        : null,
  }));
}

/** The roles an email can be filed under: every application. */
export async function getApplicationChoices(): Promise<
  { id: string; title: string; company: string }[]
> {
  await getCurrentUser();
  return db
    .select({ id: job.id, title: job.title, company: job.company })
    .from(job)
    .where(inArray(job.status, [...APPLIED_STATUSES]))
    .orderBy(job.company, job.title);
}

/**
 * Saves a pasted email for Claude to read, under the role it was pasted
 * into, or under none for the app to find. Returns its id.
 */
export async function pasteEmail(input: PasteEmailInput): Promise<string> {
  await getCurrentUser();
  if (input.jobId) {
    const [found] = await db
      .select({ id: job.id })
      .from(job)
      .where(eq(job.id, input.jobId));
    if (!found) throw new JobNotFoundError();
  }
  const [saved] = await db
    .insert(jobEmail)
    .values({
      jobId: input.jobId,
      body: input.text,
      autoFiled: input.jobId === null,
    })
    .returning({ id: jobEmail.id });
  return saved!.id;
}

/** Puts a failed email, or one whose read stopped, back to be read again. */
export async function retryEmail(
  emailId: string,
  now = new Date(),
): Promise<void> {
  await getCurrentUser();
  const updated = await db
    .update(jobEmail)
    .set({ status: "reading", error: null, queuedAt: now })
    .where(
      and(
        eq(jobEmail.id, emailId),
        or(
          eq(jobEmail.status, "failed"),
          and(
            eq(jobEmail.status, "reading"),
            lt(jobEmail.queuedAt, new Date(now.getTime() - READING_STALE_MS)),
          ),
        ),
      ),
    )
    .returning({ id: jobEmail.id });
  if (updated.length === 0) throw new EmailNotFoundError();
}

/** Marks the email's reply as sent (or dealt with), or not after all. */
export async function setEmailHandled(
  emailId: string,
  handled: boolean,
): Promise<void> {
  await getCurrentUser();
  const updated = await db
    .update(jobEmail)
    .set({ handledAt: handled ? new Date() : null })
    .where(eq(jobEmail.id, emailId))
    .returning({ id: jobEmail.id });
  if (updated.length === 0) throw new EmailNotFoundError();
}

/**
 * Removes a pasted email and its line on the timeline. A status it changed
 * stays; the role's status menu changes it back.
 */
export async function deleteEmail(emailId: string): Promise<void> {
  await getCurrentUser();
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(jobEmail)
      .where(eq(jobEmail.id, emailId))
      .returning({ jobId: jobEmail.jobId });
    if (deleted.length === 0) throw new EmailNotFoundError();
    const jobId = deleted[0]?.jobId;
    if (jobId) {
      await tx
        .delete(event)
        .where(
          and(
            eq(event.jobId, jobId),
            eq(event.type, "email_added"),
            sql`${event.payload}->>'emailId' = ${emailId}`,
          ),
        );
    }
  });
}

/**
 * Files an email the app couldn't place, or couldn't read, under the role
 * the owner picked, and puts it back to be read as about that role, so it
 * gets its summary, its reply and its effect on the role. The caller sends
 * it to be read.
 */
export async function fileEmail(
  emailId: string,
  jobId: string,
  now = new Date(),
): Promise<void> {
  await getCurrentUser();
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: job.id })
      .from(job)
      .where(eq(job.id, jobId));
    if (!found) throw new JobNotFoundError();
    const filed = await tx
      .update(jobEmail)
      .set({
        jobId,
        status: "reading",
        error: null,
        author: null,
        outcome: null,
        sure: null,
        quote: null,
        senderName: null,
        subject: null,
        summary: null,
        keyPoints: null,
        replyNeeded: false,
        reply: null,
        readAt: null,
        queuedAt: now,
      })
      .where(
        and(
          eq(jobEmail.id, emailId),
          isNull(jobEmail.jobId),
          or(
            inArray(jobEmail.status, ["done", "failed"]),
            and(
              eq(jobEmail.status, "reading"),
              lt(jobEmail.queuedAt, new Date(now.getTime() - READING_STALE_MS)),
            ),
          ),
        ),
      )
      .returning({ id: jobEmail.id });
    if (filed.length === 0) throw new EmailNotFoundError();
  });
}

/** An email whose reading couldn't be started, so the page offers to try again. */
export async function markEmailUnsent(
  emailId: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await db
    .update(jobEmail)
    .set({ status: "failed", error: message })
    .where(and(eq(jobEmail.id, emailId), eq(jobEmail.status, "reading")));
}
