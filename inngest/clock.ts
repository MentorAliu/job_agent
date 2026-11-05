import { cron } from "inngest";

import {
  nextMorningRuns,
  PLAN_EVERY_HOURS,
  type MorningJob,
  type PlannedRun,
} from "@/lib/jobs/schedule";
import { readClockSetup, readOwnerTimeZone } from "@/lib/pipeline/setup";

import { inngest } from "./client";
import {
  dailySearchDue,
  listingsCheckDue,
  noResponseCheckDue,
  timeZoneSaved,
} from "./events";

const EVENTS = {
  "check-listings": listingsCheckDue,
  "daily-search": dailySearchDue,
  "mark-no-response": noResponseCheckDue,
} satisfies Record<MorningJob, unknown>;

/** What a run scheduled in a time zone the owner has since changed says. */
export const MOVED_TIME_ZONE =
  "The time zone changed after this run was scheduled, so it runs at its time in the new one instead.";

/**
 * The morning runs to schedule now: the next of each, in the owner's time
 * zone, within PLAN_AHEAD_HOURS. None before first-run setup is finished.
 */
export async function planFrom(
  at: Date,
): Promise<{ timeZone: string; runs: PlannedRun[] }> {
  const { done, timeZone } = await readClockSetup();
  return { timeZone, runs: done ? nextMorningRuns(timeZone, at) : [] };
}

/**
 * The events that start them, each at its time. The id is the job, the
 * owner's day and the time zone, and Inngest drops an event whose id it saw
 * in the last 24 hours, so a run the clock schedules again still starts once.
 */
export function morningEvents(timeZone: string, runs: PlannedRun[]) {
  return runs.map(({ job, day, at }) =>
    EVENTS[job].create(
      { day, timeZone },
      { id: `${job}-${day}-${timeZone}`, ts: Date.parse(at) },
    ),
  );
}

/**
 * Whether a run scheduled in `timeZone` still goes ahead: the owner hasn't
 * changed the time zone since. The run in the new one replaces it.
 */
export async function stillScheduled(timeZone: string): Promise<boolean> {
  return (await readOwnerTimeZone()) === timeZone;
}

/**
 * Asks the clock to schedule the morning runs in a time zone just saved. The
 * clock does every PLAN_EVERY_HOURS anyway, so this only logs a failure.
 */
export async function scheduleMorningRuns(timeZone: string): Promise<void> {
  try {
    await inngest.send(timeZoneSaved.create({ timeZone }));
  } catch (error) {
    console.error("Couldn't ask the morning clock to schedule", error);
  }
}

/**
 * Every PLAN_EVERY_HOURS hours, at 17 past, and as soon as the time zone is
 * saved: schedules the morning runs of the next PLAN_AHEAD_HOURS hours at
 * their times in the owner's time zone. Settings can change the time zone,
 * so a cron fixed to one won't do, and scheduling ahead reads the database
 * 4 times a day, where checking every half hour would keep a database that
 * sleeps when idle, such as Neon's, awake.
 */
export const morningClock = inngest.createFunction(
  {
    id: "morning-clock",
    name: "Morning clock",
    triggers: [cron(`17 */${PLAN_EVERY_HOURS} * * *`), timeZoneSaved],
  },
  async ({ step }) => {
    const plan = await step.run("plan", () => planFrom(new Date()));
    if (plan.runs.length > 0) {
      await step.sendEvent("schedule", morningEvents(plan.timeZone, plan.runs));
    }
    return plan;
  },
);
