// Days and hours in the owner's time zone. Everything here takes the time
// zone as an argument: the server reads the owner's from the database
// (readOwnerTimeZone in lib/pipeline/setup.ts), and a Client Component gets
// its dates from the server instead.

/**
 * `value` without spaces around it when it's an IANA time zone name such as
 * `Europe/Lisbon`, or null when it isn't one. The name is kept as given:
 * Intl would turn Asia/Kolkata into Asia/Calcutta, which a browser's list of
 * time zones may not have.
 */
export function timeZoneName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** `value` when it names a time zone, otherwise UTC. */
export function timeZoneOrUtc(value: string | null | undefined): string {
  return timeZoneName(value) ?? "UTC";
}

/** A day as "YYYY-MM-DD" in the given time zone. */
export function dayIn(timeZone: string, at: Date = new Date()): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** "YYYY-MM-DD", `days` after `day`. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The hour of the day, 0 to 23, in the given time zone. */
export function hourIn(timeZone: string, at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
}

/** The hour the daily search starts, in the owner's time zone. */
export const DAILY_RUN_HOUR = 7;

/** "07:00", for saying when the daily search runs. */
export const DAILY_RUN_TIME = `${String(DAILY_RUN_HOUR).padStart(2, "0")}:00`;

/** Whether the next daily search is later today or tomorrow. */
export function nextDailyRunDay(
  timeZone: string,
  at: Date = new Date(),
): "today" | "tomorrow" {
  return hourIn(timeZone, at) < DAILY_RUN_HOUR ? "today" : "tomorrow";
}

/** The owner's time zone with today's date in it, for reading dates. */
export type OwnerClock = { timeZone: string; today: string };

export function ownerClock(
  timeZone: string,
  at: Date = new Date(),
): OwnerClock {
  return { timeZone, today: dayIn(timeZone, at) };
}
