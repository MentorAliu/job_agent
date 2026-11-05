import "server-only";

import { eq } from "drizzle-orm";

import { event, job } from "@/db/schema";
import type { Db } from "@/lib/dal/db";
import { replyUpdate } from "@/lib/mail/rules";
import type { EmailAuthor, MailOutcome } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

// Writes to a role that both lib/dal (for the owner) and the Inngest steps
// (for an email the owner pasted) make, inside the caller's transaction.

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Moves a locked role's follow-up from `was` to `on`, on the timeline too. */
export async function writeFollowUp(
  tx: Tx,
  jobId: string,
  was: string | null,
  on: string | null,
): Promise<void> {
  if (was === on) return;
  await tx.update(job).set({ followUpOn: on }).where(eq(job.id, jobId));
  if (on) {
    await tx.insert(event).values({
      jobId,
      type: "follow_up_set",
      payload: { on },
    });
  } else if (was) {
    await tx.insert(event).values({
      jobId,
      type: "follow_up_cleared",
      payload: { was },
    });
  }
}

/** Characters of the summary kept on the timeline. */
const TIMELINE_SUMMARY_CHARS = 300;

export type EmailForRole = {
  emailId: string;
  jobId: string;
  author: EmailAuthor;
  outcome: MailOutcome;
  quote: string;
  sure: boolean;
  summary: string;
};

/**
 * Puts the email on its role's timeline and moves the role as its outcome
 * says (lib/mail/rules). Only an employer's email moves a role. Returns the
 * status it moved to, or null when it stayed.
 */
export async function applyEmailToRole(
  tx: Tx,
  email: EmailForRole,
): Promise<JobStatus | null> {
  const [current] = await tx
    .select({ status: job.status })
    .from(job)
    .where(eq(job.id, email.jobId))
    .for("update");
  if (!current) return null;

  const summary =
    email.summary.length > TIMELINE_SUMMARY_CHARS
      ? `${email.summary.slice(0, TIMELINE_SUMMARY_CHARS)}…`
      : email.summary;
  await tx.insert(event).values({
    jobId: email.jobId,
    type: "email_added",
    payload: {
      emailId: email.emailId,
      author: email.author,
      outcome: email.outcome,
      summary,
      sure: email.sure,
    },
  });

  if (email.author !== "employer" || email.outcome === "unrelated") {
    return null;
  }
  const to = replyUpdate(current.status, email.outcome, email.sure);
  if (!to || to === current.status) return null;
  await tx.update(job).set({ status: to }).where(eq(job.id, email.jobId));
  await tx.insert(event).values({
    jobId: email.jobId,
    type: "status_changed",
    payload: {
      from: current.status,
      to,
      reason: email.quote || null,
      source: "email",
      emailId: email.emailId,
    },
  });
  return to;
}
