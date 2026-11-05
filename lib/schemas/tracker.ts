// The tracker: a role's status, the reasons the owner gives when sorting new
// matches, notes and follow-ups, and the timeline events these write.
import { z } from "zod";

import { EMAIL_AUTHORS, MAIL_OUTCOMES } from "./mail";
import { DOCUMENT_KINDS } from "./tailor";

/** A role's status. `db/schema.ts` builds the `job_status` enum from this list. */
export const JOB_STATUSES = [
  "new",
  "shortlisted",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "no_response",
  "withdrawn",
  "skipped",
  "not_eligible",
  // The employer took the posting down before the owner applied.
  "listing_closed",
  // The owner took the role off their lists. It can be restored.
  "removed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Statuses before an application goes out. Moving a role back to one of
 * these forgets an applied date that a status change set.
 */
export const BEFORE_APPLYING: readonly JobStatus[] = [
  "new",
  "shortlisted",
  "ready",
  "skipped",
  "not_eligible",
  "listing_closed",
  "removed",
];

/** Roles that are over. Their follow-ups no longer count as due. */
export const CLOSED_STATUSES: readonly JobStatus[] = [
  "rejected",
  "no_response",
  "withdrawn",
  "skipped",
  "not_eligible",
  "listing_closed",
  "removed",
];

export const REASON_MAX = 500;

/**
 * A status change. The reason is optional: the app writes its own when it
 * picks or passes over a role, and the owner never has to give one.
 */
export const statusChangeSchema = z.object({
  jobId: z.uuid(),
  status: z.enum(JOB_STATUSES),
  reason: z
    .string()
    .trim()
    .max(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`),
});

export type StatusChange = z.infer<typeof statusChangeSchema>;

/** Remove or Restore: just the role. */
export const jobRefSchema = z.object({ jobId: z.uuid() });
export type JobRef = z.infer<typeof jobRefSchema>;

// ---------------------------------------------------------------------------
// Timeline events (the `event` table)
// ---------------------------------------------------------------------------

/**
 * Who changed a status: the owner (or the app on their behalf, as when a kit
 * is ready), an employer's email, no reply for too long, or the daily check
 * that finds listings the employer closed. Events from before this was
 * recorded have none.
 */
export const STATUS_SOURCES = [
  "owner",
  "email",
  "no_reply",
  "listing",
] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

export const jobEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_changed"),
    payload: z.object({
      from: z.enum(JOB_STATUSES),
      to: z.enum(JOB_STATUSES),
      reason: z.string().nullable(),
      source: z.enum(STATUS_SOURCES).optional(),
      /** The pasted email that made the change, when one did. */
      emailId: z.uuid().optional(),
    }),
  }),
  z.object({
    // An email the owner pasted into the role, once Claude has read it.
    type: z.literal("email_added"),
    payload: z.object({
      emailId: z.uuid(),
      author: z.enum(EMAIL_AUTHORS),
      outcome: z.enum(MAIL_OUTCOMES),
      /** Claude's summary, cut to fit a line. */
      summary: z.string(),
      /** False when Claude wasn't sure, so the status was left alone. */
      sure: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("follow_up_set"),
    payload: z.object({ on: z.iso.date() }),
  }),
  z.object({
    type: z.literal("follow_up_cleared"),
    payload: z.object({ was: z.iso.date() }),
  }),
  z.object({
    type: z.literal("documents_ready"),
    payload: z.object({
      documents: z.array(
        z.object({
          kind: z.enum(DOCUMENT_KINDS),
          version: z.number().int(),
        }),
      ),
      note: z.string().nullable(),
      /** The owner edited the CV on the CVs page. */
      edited: z.boolean().optional(),
    }),
  }),
  z.object({
    // The documents that went out with the application.
    type: z.literal("documents_sent"),
    payload: z.object({
      documents: z.array(
        z.object({
          kind: z.enum(DOCUMENT_KINDS),
          version: z.number().int(),
        }),
      ),
    }),
  }),
]);

export type JobEvent = z.infer<typeof jobEventSchema>;
