import { NonRetriableError } from "inngest";

import { BudgetExceededError } from "@/lib/claude/budget";
import { readEmail, ReadEmailError } from "@/lib/claude/read-email";
import { rolesNamedIn } from "@/lib/mail/match";
import { splitEmail } from "@/lib/mail/text";
import {
  getAppliedCompanies,
  getEmailCandidate,
  getEmailRoles,
  getPastedEmail,
  markEmailFailed,
  markUnanswered,
  saveEmailReading,
  type PastedEmail,
} from "@/lib/pipeline/emails";
import { NO_RESPONSE_DAYS, type MailOutcome } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

import { inngest } from "./client";
import { MOVED_TIME_ZONE, stillScheduled } from "./clock";
import { permanentOrRetry } from "./errors";
import { emailPasted, noResponseCheckDue } from "./events";

/** A refusal or a full monthly budget would fail the same way on a retry. */
const PERMANENT_ERRORS = [ReadEmailError, BudgetExceededError];

/**
 * Named roles whose earlier emails go along with an email pasted without a
 * role. With more than this, Claude gets every application without them.
 */
const MAX_NAMED_ROLES = 3;

export type ReadEmailOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "read";
      jobId: string | null;
      outcome: MailOutcome;
      movedTo: JobStatus | null;
    };

/**
 * The applications Claude chooses from: the role the email was pasted into,
 * the roles it names, or every application.
 */
async function rolesFor(email: PastedEmail) {
  if (email.jobId) {
    return getEmailRoles({
      jobIds: [email.jobId],
      earlier: true,
      exceptEmailId: email.id,
    });
  }
  const named = rolesNamedIn(email.body, await getAppliedCompanies());
  if (named.length === 0 || named.length > MAX_NAMED_ROLES) {
    return getEmailRoles({ jobIds: null, earlier: false });
  }
  return getEmailRoles({
    jobIds: named.map((role) => role.id),
    earlier: true,
    exceptEmailId: email.id,
  });
}

/**
 * Reads one pasted email: which application it's about, what it means, a
 * summary and a suggested reply, then moves the role on. Everything is saved
 * inside the step, which returns no email text, so none of it ends up in
 * Inngest's step history.
 */
export async function readEmailStep(
  emailId: string,
): Promise<ReadEmailOutcome> {
  const email = await getPastedEmail(emailId);
  if (!email)
    throw new NonRetriableError(`No pasted email with id ${emailId}.`);
  if (email.status !== "reading") {
    return { status: "skipped", reason: `The email is ${email.status}.` };
  }
  try {
    const [roles, candidate] = await Promise.all([
      rolesFor(email),
      getEmailCandidate(),
    ]);
    const reading = await readEmail(candidate, roles, splitEmail(email.body));
    const saved = await saveEmailReading(
      emailId,
      email.jobId ?? reading.jobId,
      reading,
    );
    return {
      status: "read",
      jobId: saved.jobId,
      outcome: reading.outcome,
      movedTo: saved.movedTo,
    };
  } catch (error) {
    throw permanentOrRetry(error, PERMANENT_ERRORS);
  }
}

/**
 * Reads emails one at a time, so a second email on a role is read with the
 * first one's summary and reply.
 */
export const readPastedEmail = inngest.createFunction(
  {
    id: "read-email",
    name: "Read a pasted email",
    triggers: [emailPasted],
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { data, ts } = event.data.event;
      await markEmailFailed(
        data.emailId,
        error.message,
        ts ? new Date(ts) : undefined,
      );
    },
  },
  async ({ event, step }) =>
    step.run("read", () => readEmailStep(event.data.emailId)),
);

/**
 * Every morning at 07:30 in the owner's time zone, scheduled by the morning
 * clock (inngest/clock.ts): moves roles that have waited NO_RESPONSE_DAYS
 * since applying with no email from the company to No response.
 */
export const markNoResponse = inngest.createFunction(
  {
    id: "mark-no-response",
    name: "Mark roles with no reply",
    triggers: [noResponseCheckDue],
  },
  async ({ event, step }) =>
    step.run("mark", async () =>
      (await stillScheduled(event.data.timeZone))
        ? { moved: await markUnanswered(NO_RESPONSE_DAYS) }
        : { skipped: MOVED_TIME_ZONE },
    ),
);
