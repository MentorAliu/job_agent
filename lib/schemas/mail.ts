// Employers' emails, which the owner pastes into the app: what Claude says
// each one means, the reply it suggests, and the Server Actions' inputs.
import { z } from "zod";

/**
 * What an email from a company says about an application. Matches the
 * `mail_outcome` enum. `unrelated`: not about the application it was pasted
 * into, or about none of them.
 */
export const MAIL_OUTCOMES = [
  "received",
  "rejected",
  "interview",
  "assessment",
  "offer",
  "other",
  "unrelated",
] as const;
export type MailOutcome = (typeof MAIL_OUTCOMES)[number];

/** Outcomes about an application, as the timeline shows them. */
export const REPLY_OUTCOMES = [
  "received",
  "rejected",
  "interview",
  "assessment",
  "offer",
  "other",
] as const satisfies readonly MailOutcome[];
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];

/**
 * Who wrote a pasted email: the company, or the owner (a reply they sent,
 * pasted so the conversation is complete). Matches the `email_author` enum.
 */
export const EMAIL_AUTHORS = ["employer", "candidate"] as const;
export type EmailAuthor = (typeof EMAIL_AUTHORS)[number];

/** Where reading a pasted email stands. Matches the `email_read_status` enum. */
export const EMAIL_READ_STATUSES = ["reading", "done", "failed"] as const;
export type EmailReadStatus = (typeof EMAIL_READ_STATUSES)[number];

/** A reply Claude suggests, for the owner to copy and send themselves. */
export type SuggestedReply = { subject: string; body: string };

/**
 * What Claude returns for one pasted email. The reason comes first, so the
 * model reads the email before it decides; the code checks the quote and the
 * role. As with the other structured outputs, every field is required and
 * plain.
 */
export const emailReadingSchema = z.object({
  reason: z
    .string()
    .describe(
      "One short sentence, written before deciding: who wrote the email, and which application it is about.",
    ),
  roleRef: z
    .string()
    .describe(
      'The ref of the application the email is about, such as "r1", or "none".',
    ),
  author: z.enum(EMAIL_AUTHORS),
  outcome: z.enum(MAIL_OUTCOMES),
  quote: z
    .string()
    .describe(
      "The one sentence from the email that shows the outcome, copied word for word. Empty string for unrelated.",
    ),
  sure: z
    .boolean()
    .describe(
      "false when the email is ambiguous, or could be about more than one of the applications.",
    ),
  senderName: z
    .string()
    .describe(
      "The name of the person who wrote it, as the email signs it. Empty string when it doesn't say.",
    ),
  subject: z
    .string()
    .describe(
      "The email's subject line, when the pasted text includes it. Empty string otherwise.",
    ),
  summary: z
    .string()
    .describe(
      "At most two plain sentences: what the email says and what it asks of the candidate.",
    ),
  keyPoints: z
    .array(z.string())
    .describe(
      "Up to 4 short facts worth keeping: dates and times with their time zone, people and their roles, deadlines, what to prepare. Empty when there are none.",
    ),
  replyNeeded: z
    .boolean()
    .describe(
      "true when the company is waiting for an answer from the candidate.",
    ),
  replySubject: z
    .string()
    .describe("The suggested reply's subject line. Empty string for no reply."),
  replyBody: z
    .string()
    .describe(
      "The suggested reply, ready to send, signed with the candidate's name. Empty string for no reply.",
    ),
});
export type EmailReading = z.infer<typeof emailReadingSchema>;

/** Characters of a pasted email that are kept. */
export const PASTE_MAX_CHARS = 30_000;

/** Characters of the newest message Claude reads. */
export const MAX_EMAIL_CHARS = 6000;

/** Characters of the thread quoted under it that Claude reads too. */
export const MAX_QUOTED_CHARS = 2000;

/**
 * A read that hasn't finished after this long has stopped (Inngest couldn't
 * reach the app, say), so the page shows it as failed with Try again.
 */
export const READING_STALE_MS = 10 * 60_000;

/** Earlier emails on a role that go along with a new one, newest kept. */
export const MAX_EARLIER_EMAILS = 6;

/**
 * Days after applying with no email from the company before a role moves to
 * No response.
 */
export const NO_RESPONSE_DAYS = 30;

/**
 * An email the owner pastes: into one role, or on the Applications page,
 * where the app works out which role it's about.
 */
export const pasteEmailSchema = z.object({
  jobId: z.uuid().nullable(),
  text: z
    .string()
    .trim()
    .min(20, "Paste the whole email, not just a line of it.")
    .max(
      PASTE_MAX_CHARS,
      `That's longer than an email: keep it under ${PASTE_MAX_CHARS.toLocaleString("en")} characters.`,
    ),
});
export type PasteEmailInput = z.infer<typeof pasteEmailSchema>;

export const emailIdSchema = z.object({ emailId: z.uuid() });

/** The suggested reply copied, or dealt with another way, or not after all. */
export const emailHandledSchema = z.object({
  emailId: z.uuid(),
  handled: z.boolean(),
});

/** An email the app couldn't place, filed under a role by the owner. */
export const fileEmailSchema = z.object({
  emailId: z.uuid(),
  jobId: z.uuid(),
});
