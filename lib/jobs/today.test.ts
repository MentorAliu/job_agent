import { describe, expect, it } from "vitest";

import {
  addDays,
  dayIn,
  hourIn,
  nextDailyRunDay,
  ownerClock,
  timeZoneName,
  timeZoneOrUtc,
} from "./today";

describe("timeZoneName", () => {
  it("keeps a time zone name as given, without spaces around it", () => {
    expect(timeZoneName("America/New_York")).toBe("America/New_York");
    // Not turned into Asia/Calcutta, as Intl would.
    expect(timeZoneName(" Asia/Kolkata ")).toBe("Asia/Kolkata");
    expect(timeZoneName("UTC")).toBe("UTC");
  });

  it("is null for anything that isn't a time zone", () => {
    expect(timeZoneName("")).toBeNull();
    expect(timeZoneName("   ")).toBeNull();
    expect(timeZoneName(null)).toBeNull();
    expect(timeZoneName("Lisbon")).toBeNull();
  });
});

describe("timeZoneOrUtc", () => {
  it("keeps a saved time zone and falls back to UTC", () => {
    expect(timeZoneOrUtc("Europe/Belgrade")).toBe("Europe/Belgrade");
    expect(timeZoneOrUtc(null)).toBe("UTC");
    expect(timeZoneOrUtc("Mars/Olympus")).toBe("UTC");
  });
});

describe("days and hours in a time zone", () => {
  // 23:30 UTC on 18 October.
  const late = new Date("2026-10-18T23:30:00Z");

  it("turns the day over at the time zone's midnight", () => {
    expect(dayIn("UTC", late)).toBe("2026-10-18");
    // Already the 19th in Belgrade (UTC+2 in summer).
    expect(dayIn("Europe/Belgrade", late)).toBe("2026-10-19");
    // Still the afternoon of the 18th in Los Angeles.
    expect(dayIn("America/Los_Angeles", late)).toBe("2026-10-18");
  });

  it("reads the hour in the time zone", () => {
    expect(hourIn("UTC", late)).toBe(23);
    expect(hourIn("Europe/Belgrade", late)).toBe(1);
    expect(hourIn("Asia/Kolkata", late)).toBe(5);
  });

  it("says whether the next daily search is today or tomorrow", () => {
    // 06:59 and 07:00 in Lisbon, on winter time (UTC+0).
    expect(
      nextDailyRunDay("Europe/Lisbon", new Date("2026-11-05T06:59:00Z")),
    ).toBe("today");
    expect(
      nextDailyRunDay("Europe/Lisbon", new Date("2026-11-05T07:00:00Z")),
    ).toBe("tomorrow");
  });

  it("gives the owner's clock: the time zone and its date", () => {
    expect(ownerClock("Europe/Belgrade", late)).toEqual({
      timeZone: "Europe/Belgrade",
      today: "2026-10-19",
    });
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 7)).toBe("2027-01-07");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
