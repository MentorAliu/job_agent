import { describe, expect, it } from "vitest";

import {
  MORNING_JOBS,
  nextMorningRuns,
  PLAN_AHEAD_HOURS,
  PLAN_EVERY_HOURS,
  zonedTime,
} from "./schedule";

const iso = (timeZone: string, day: string, time: string) =>
  zonedTime(timeZone, day, time).toISOString();

describe("zonedTime", () => {
  it("finds the moment a time of day comes in the time zone", () => {
    // Belgrade is UTC+1 in November and UTC+2 in July.
    expect(iso("Europe/Belgrade", "2026-11-05", "07:00")).toBe(
      "2026-11-05T06:00:00.000Z",
    );
    expect(iso("Europe/Belgrade", "2026-07-05", "07:00")).toBe(
      "2026-07-05T05:00:00.000Z",
    );
    expect(iso("America/New_York", "2026-11-05", "06:30")).toBe(
      "2026-11-05T11:30:00.000Z",
    );
    expect(iso("Asia/Kathmandu", "2026-11-05", "07:00")).toBe(
      "2026-11-05T01:15:00.000Z",
    );
    expect(iso("UTC", "2026-11-05", "07:30")).toBe("2026-11-05T07:30:00.000Z");
  });

  it("takes the offset the day has when summer time starts or ends", () => {
    // Europe changes its clocks on 29 March and 25 October 2026, New York
    // on 8 March and 1 November, each in the night before.
    expect(iso("Europe/Belgrade", "2026-03-29", "07:00")).toBe(
      "2026-03-29T05:00:00.000Z",
    );
    expect(iso("Europe/Belgrade", "2026-10-25", "07:00")).toBe(
      "2026-10-25T06:00:00.000Z",
    );
    expect(iso("America/New_York", "2026-03-08", "07:00")).toBe(
      "2026-03-08T11:00:00.000Z",
    );
    expect(iso("America/New_York", "2026-11-01", "07:00")).toBe(
      "2026-11-01T12:00:00.000Z",
    );
    // An hour after the clocks went forward, the first guess is an hour out.
    expect(iso("America/New_York", "2026-03-08", "03:30")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("puts a morning east of the date line on the evening before in UTC", () => {
    // Auckland is UTC+13 in November.
    expect(iso("Pacific/Auckland", "2026-11-05", "07:00")).toBe(
      "2026-11-04T18:00:00.000Z",
    );
  });
});

describe("nextMorningRuns", () => {
  it("gives each job's next start with the owner's day it's for", () => {
    // 18:17 UTC is 19:17 in Belgrade: all three run tomorrow morning.
    expect(
      nextMorningRuns("Europe/Belgrade", new Date("2026-11-05T18:17:00Z")),
    ).toEqual([
      {
        job: "check-listings",
        day: "2026-11-06",
        at: "2026-11-06T05:30:00.000Z",
      },
      {
        job: "daily-search",
        day: "2026-11-06",
        at: "2026-11-06T06:00:00.000Z",
      },
      {
        job: "mark-no-response",
        day: "2026-11-06",
        at: "2026-11-06T06:30:00.000Z",
      },
    ]);
  });

  it("leaves a start more than PLAN_AHEAD_HOURS away for a later schedule", () => {
    // 06:17 UTC is 07:17 in Belgrade: today's check and search have started,
    // and tomorrow's are 23 hours off. The no-reply check is at 07:30 today.
    expect(
      nextMorningRuns("Europe/Belgrade", new Date("2026-11-05T06:17:00Z")),
    ).toEqual([
      {
        job: "mark-no-response",
        day: "2026-11-05",
        at: "2026-11-05T06:30:00.000Z",
      },
    ]);
  });

  it("counts a start at that very moment as gone", () => {
    const runs = nextMorningRuns(
      "Europe/Belgrade",
      new Date("2026-11-05T06:00:00Z"),
    );
    expect(runs.map(({ job }) => job)).toEqual(["mark-no-response"]);
  });

  it("follows the owner's day, not UTC's", () => {
    // 12:17 UTC on the 4th is already the 5th in Auckland, and 07:17 in
    // New York, after its check and search.
    expect(
      nextMorningRuns("Pacific/Auckland", new Date("2026-11-04T12:17:00Z")).map(
        ({ day, at }) => [day, at],
      ),
    ).toEqual([
      ["2026-11-05", "2026-11-04T17:30:00.000Z"],
      ["2026-11-05", "2026-11-04T18:00:00.000Z"],
      ["2026-11-05", "2026-11-04T18:30:00.000Z"],
    ]);
    expect(
      nextMorningRuns("America/New_York", new Date("2026-11-04T12:17:00Z")),
    ).toEqual([
      {
        job: "mark-no-response",
        day: "2026-11-04",
        at: "2026-11-04T12:30:00.000Z",
      },
    ]);
  });

  it("schedules every run a few times, always within the 24 hours Inngest drops a repeated id in", () => {
    const zones = [
      "Europe/Belgrade",
      "Europe/London",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Pacific/Auckland",
      "UTC",
    ];
    const hour = 3_600_000;
    // Every schedule over three weeks that take in the end of summer time
    // in Europe and in the United States.
    const start = Date.parse("2026-10-18T00:17:00Z");
    const end = Date.parse("2026-11-08T00:17:00Z");
    for (const timeZone of zones) {
      const sends = new Map<string, { at: number; sentAt: number[] }>();
      for (let at = start; at <= end; at += PLAN_EVERY_HOURS * hour) {
        for (const run of nextMorningRuns(timeZone, new Date(at))) {
          const key = `${run.job}-${run.day}`;
          const entry = sends.get(key) ?? {
            at: Date.parse(run.at),
            sentAt: [],
          };
          entry.sentAt.push(at);
          sends.set(key, entry);
        }
      }
      // Leave out the edges, which the schedules before and after cover.
      const covered = [...sends.values()].filter(
        ({ at }) => at > start + 24 * hour && at < end - 24 * hour,
      );
      expect(covered.length).toBe(MORNING_JOBS.length * 19);
      for (const { at, sentAt } of covered) {
        expect(sentAt.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...sentAt) - Math.min(...sentAt)).toBeLessThan(
          24 * hour,
        );
        expect(Math.min(...sentAt)).toBeGreaterThanOrEqual(
          at - PLAN_AHEAD_HOURS * hour,
        );
        expect(Math.max(...sentAt)).toBeLessThan(at);
      }
    }
  });
});
