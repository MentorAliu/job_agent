import { describe, expect, it } from "vitest";

import {
  formatPostedAge,
  FRESH_DAYS,
  freshnessAge,
  isStale,
  postedAgo,
  postedDay,
  postingAgeDays,
  STALE_DAYS,
} from "./posted";
import { addDays } from "./today";

const TODAY = "2026-10-25";
const BELGRADE = { timeZone: "Europe/Belgrade", today: TODAY };

describe("postedDay", () => {
  it("reads the dates job boards give, as the owner's day", () => {
    expect(postedDay("2026-10-20", BELGRADE)).toBe("2026-10-20");
    // 23:30 UTC is already the next day in Belgrade.
    expect(postedDay("2026-10-20T23:30:00Z", BELGRADE)).toBe("2026-10-21");
    expect(postedDay("2026-10-02T11:31:50-04:00", BELGRADE)).toBe("2026-10-02");
    expect(postedDay("2026-10-15T09:31:36.123+0000", BELGRADE)).toBe(
      "2026-10-15",
    );
    // Recruitee's own way of writing a time.
    expect(postedDay("2026-10-15 09:31:36 UTC", BELGRADE)).toBe("2026-10-15");
    // Lever's milliseconds.
    expect(postedDay(Date.UTC(2026, 9, 20, 23, 30), BELGRADE)).toBe(
      "2026-10-21",
    );
  });

  it("drops dates in words, which could be read with the wrong year", () => {
    for (const value of [
      "13 October",
      "October 13, 2026",
      "3 days ago",
      "",
      null,
      undefined,
      Number.NaN,
    ]) {
      expect(postedDay(value, BELGRADE), String(value)).toBeNull();
    }
  });

  it("drops days that aren't on the calendar or aren't plausible", () => {
    expect(postedDay("2026-02-30", BELGRADE)).toBeNull();
    expect(postedDay("2026-13-01", BELGRADE)).toBeNull();
    expect(postedDay("1999-12-31", BELGRADE)).toBeNull();
    expect(postedDay("2026-10-27", BELGRADE)).toBeNull();
  });

  it("counts tomorrow, from a time zone further east, as today", () => {
    expect(postedDay("2026-10-26", BELGRADE)).toBe(TODAY);
  });

  it("reads a time as the day it was in the owner's time zone", () => {
    // 23:30 UTC on the 20th is still the evening of the 20th in New York.
    expect(
      postedDay("2026-10-20T23:30:00Z", {
        timeZone: "America/New_York",
        today: TODAY,
      }),
    ).toBe("2026-10-20");
  });
});

describe("a posting's age", () => {
  it("counts whole days", () => {
    expect(postingAgeDays(TODAY, TODAY)).toBe(0);
    expect(postingAgeDays("2026-10-24", TODAY)).toBe(1);
    expect(postingAgeDays("2026-09-25", TODAY)).toBe(30);
  });

  it("calls postings older than STALE_DAYS stale, and never an undated one", () => {
    expect(isStale(addDays(TODAY, -STALE_DAYS), TODAY)).toBe(false);
    expect(isStale(addDays(TODAY, -STALE_DAYS - 1), TODAY)).toBe(true);
    expect(isStale(null, TODAY)).toBe(false);
  });

  it("puts an undated posting after this week's and before older ones", () => {
    expect(freshnessAge(TODAY, TODAY)).toBe(0);
    expect(freshnessAge(addDays(TODAY, -10), TODAY)).toBe(10);
    expect(freshnessAge(null, TODAY)).toBe(FRESH_DAYS);
  });

  it("says how long ago in words", () => {
    expect(postedAgo(TODAY, TODAY)).toBe("today");
    expect(postedAgo("2026-10-24", TODAY)).toBe("yesterday");
    expect(postedAgo("2026-10-12", TODAY)).toBe("13 days ago");
    expect(postedAgo("2026-10-11", TODAY)).toBe("2 weeks ago");
    expect(postedAgo("2026-08-27", TODAY)).toBe("8 weeks ago");
    expect(postedAgo("2026-08-26", TODAY)).toBe("2 months ago");
    expect(postedAgo("2025-10-25", TODAY)).toBe("over a year ago");
    expect(formatPostedAge("2026-10-22", TODAY)).toBe("Posted 3 days ago");
  });
});
