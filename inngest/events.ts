import { eventType } from "inngest";
import { z } from "zod";

/** Sent by the CV upload Route Handler. Starts step 1 of the pipeline. */
export const cvUploaded = eventType("profile/cv.uploaded", {
  schema: z.object({ fileId: z.uuid() }),
});

/**
 * Sent by Search now and by the daily cron, after the run row is created.
 * Starts steps 2–6 of the pipeline.
 */
export const searchRunRequested = eventType("search/run.requested", {
  schema: z.object({ runId: z.uuid() }),
});

/**
 * Sent when a role is shortlisted, and by Tailor and Regenerate in the apply
 * kit, after the request is recorded on the role. Starts steps 7–10.
 */
export const tailorRequested = eventType("job/tailor.requested", {
  schema: z.object({ jobId: z.uuid(), requestId: z.uuid() }),
});

/**
 * Sent when the owner pastes an email, and when they ask for a failed one
 * to be read again, after the email is saved.
 */
export const emailPasted = eventType("email/pasted", {
  schema: z.object({ emailId: z.uuid() }),
});

/** Sent by the CV builder's form, after the CV is saved as being written. */
export const cvBuildRequested = eventType("cv/build.requested", {
  schema: z.object({ cvId: z.uuid() }),
});

/**
 * Sent by Check it works, in setup and in Settings, after the check is saved
 * as queued.
 */
export const engineCheckRequested = eventType("engine/check.requested", {
  schema: z.object({ checkId: z.uuid() }),
});

/**
 * The owner's day a morning run is for, "YYYY-MM-DD", and the time zone it
 * was scheduled in.
 */
const morningRun = z.object({ day: z.iso.date(), timeZone: z.string().min(1) });

/**
 * Sent ahead by the morning clock (inngest/clock.ts), to start at 06:30,
 * 07:00 and 07:30 in the owner's time zone. Each id is the job, the owner's
 * day and the time zone, so a run starts once however often the clock
 * schedules it. One scheduled in a time zone the owner has since changed
 * does nothing.
 */
export const listingsCheckDue = eventType("schedule/listings-check.due", {
  schema: morningRun,
});

export const dailySearchDue = eventType("schedule/daily-search.due", {
  schema: morningRun,
});

export const noResponseCheckDue = eventType("schedule/no-response-check.due", {
  schema: morningRun,
});

/**
 * Sent when the owner's time zone is saved, by setup and by Settings, so the
 * morning clock schedules the runs in it at once.
 */
export const timeZoneSaved = eventType("schedule/time-zone.saved", {
  schema: z.object({ timeZone: z.string().min(1) }),
});
