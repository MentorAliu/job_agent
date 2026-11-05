import { addDays, DAILY_RUN_TIME, dayIn } from "./today";

// The morning runs, at their time of day in the owner's time zone. Every few
// hours, and whenever the time zone is saved, the morning clock in
// inngest/clock.ts schedules the ones coming up, so they follow the time zone
// saved in Settings without asking the database for it every half hour.

export const MORNING_JOBS = [
  /** Listings closed by the employer move to Listing closed. */
  { job: "check-listings", time: "06:30" },
  /** The daily search, which then picks roles for kits. */
  { job: "daily-search", time: DAILY_RUN_TIME },
  /** Roles with no reply for weeks move to No response. */
  { job: "mark-no-response", time: "07:30" },
] as const;

export type MorningJob = (typeof MORNING_JOBS)[number]["job"];

/** How often the clock schedules, in hours. */
export const PLAN_EVERY_HOURS = 6;

/**
 * How far ahead it schedules, in hours. Longer than PLAN_EVERY_HOURS, so a
 * few schedules in a row cover each run in case one fails, and shorter than
 * the 24 hours Inngest remembers an event's id for, so it drops the repeats.
 */
export const PLAN_AHEAD_HOURS = 20;

/** A morning run as scheduled: the owner's day it's for, and when it starts. */
export type PlannedRun = { job: MorningJob; day: string; at: string };

/** The wall clock in `timeZone` at `at`, written as if it were UTC, in ms. */
function wallClock(timeZone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** The moment it's `time` ("07:00") on `day` ("2026-11-05") in `timeZone`. */
export function zonedTime(timeZone: string, day: string, time: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const offset = (at: number) =>
    wallClock(timeZone, at) - Math.floor(at / 1000) * 1000;
  // The offset where the wall time would be in UTC is a first guess, and the
  // one at that guess is right unless summer time starts or ends in between.
  return new Date(wall - offset(wall - offset(wall)));
}

/**
 * Each morning job's next start after `after` in `timeZone`, with the
 * owner's day it's for, when it's at most `aheadHours` away.
 */
export function nextMorningRuns(
  timeZone: string,
  after: Date,
  aheadHours: number = PLAN_AHEAD_HOURS,
): PlannedRun[] {
  const today = dayIn(timeZone, after);
  const latest = after.getTime() + aheadHours * 3_600_000;
  return MORNING_JOBS.flatMap(({ job, time }) => {
    for (const day of [today, addDays(today, 1)]) {
      const at = zonedTime(timeZone, day, time).getTime();
      if (at > after.getTime()) {
        return at <= latest
          ? [{ job, day, at: new Date(at).toISOString() }]
          : [];
      }
    }
    return [];
  });
}
