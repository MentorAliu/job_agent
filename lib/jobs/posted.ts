// How fresh a posting is. Most replies come in a posting's first days, so
// the app gives apply kits to the newest strong roles first and passes over
// postings too old to be worth one.
import { addDays, dayIn, type OwnerClock } from "./today";

/** A posting this many days old or newer is fresh. */
export const FRESH_DAYS = 7;
/** A posting older than this is passed over instead of getting a kit. */
export const STALE_DAYS = 21;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An ISO 8601 time, such as "2026-10-02T11:31:50-04:00". */
const ISO_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
/** Recruitee writes times as "2026-10-15 09:31:36 UTC". */
const SPACED_UTC = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?) UTC$/;

/** Whether "YYYY-MM-DD" is a day on the calendar, not 2026-02-30. */
function isCalendarDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
}

/**
 * A posting date as "YYYY-MM-DD" in the owner's time zone: from a day, an
 * ISO 8601 time or milliseconds since 1970. Null for anything else, since
 * a date in words can be read with the wrong year, and for a date that
 * isn't plausible (before 2000, or after tomorrow). A date a few hours
 * ahead of the owner, from a time zone further east, counts as today.
 */
export function postedDay(
  value: unknown,
  { today, timeZone }: OwnerClock,
): string | null {
  let day: string | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    day = dayIn(timeZone, new Date(value));
  } else if (typeof value === "string") {
    const trimmed = value.trim().replace(SPACED_UTC, "$1T$2Z");
    if (DAY.test(trimmed)) {
      day = trimmed;
    } else if (ISO_TIME.test(trimmed)) {
      const time = Date.parse(trimmed);
      if (!Number.isNaN(time)) day = dayIn(timeZone, new Date(time));
    }
  }
  if (!day || !isCalendarDay(day)) return null;
  if (day < "2000-01-01" || day > addDays(today, 1)) return null;
  return day > today ? today : day;
}

/** Whole days from the day a posting went up to `today`. */
export function postingAgeDays(postedOn: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${postedOn}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Too old for a kit. A posting with no date isn't. */
export function isStale(postedOn: string | null, today: string): boolean {
  return postedOn !== null && postingAgeDays(postedOn, today) > STALE_DAYS;
}

/**
 * How old a posting is, for putting the newest first. One with no date
 * counts as FRESH_DAYS old: after this week's postings, before older ones.
 */
export function freshnessAge(postedOn: string | null, today: string): number {
  return postedOn === null
    ? FRESH_DAYS
    : Math.max(0, postingAgeDays(postedOn, today));
}

/** "today", "yesterday", "3 days ago", "2 weeks ago". */
export function postedAgo(postedOn: string, today: string): string {
  const days = Math.max(0, postingAgeDays(postedOn, today));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return "over a year ago";
}

/** "Posted today", "Posted 3 days ago", "Posted 2 weeks ago". */
export function formatPostedAge(postedOn: string, today: string): string {
  return `Posted ${postedAgo(postedOn, today)}`;
}
