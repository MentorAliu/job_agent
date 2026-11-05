import { describe, expect, it } from "vitest";

import { dateWhen, dayWhen, foundWhen, shortWhen } from "./relative-date";

// Local times, so the tests read the same in any time zone.
const NOW = new Date(2026, 9, 18, 21, 30).getTime(); // Sunday 18 Oct 2026
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

describe("shortWhen", () => {
  it("gives the time today, the weekday this week and the day before", () => {
    expect(shortWhen(at(18, 7, 4), NOW)).toBe("07:04");
    expect(shortWhen(at(17, 23, 59), NOW)).toBe("Sat");
    expect(shortWhen(at(12, 9, 0), NOW)).toBe("Mon");
    expect(shortWhen(at(11, 9, 0), NOW)).toBe("11 Oct");
  });
});

describe("foundWhen", () => {
  it("reads as part of a sentence", () => {
    expect(foundWhen(at(18, 7, 4), NOW)).toBe("today at 07:04");
    expect(foundWhen(at(17, 18, 20), NOW)).toBe("yesterday at 18:20");
    expect(foundWhen(at(14, 7, 3), NOW)).toBe("on Wednesday at 07:03");
    expect(foundWhen(at(2, 7, 3), NOW)).toBe("on 2 Oct");
  });
});

describe("dayWhen", () => {
  it("says today and yesterday, then the date", () => {
    expect(dayWhen(at(18, 0, 5), NOW)).toBe("today");
    expect(dayWhen(at(17, 23, 59), NOW)).toBe("yesterday");
    expect(dayWhen(at(2, 7, 3), NOW)).toBe("2 Oct");
    expect(dayWhen(new Date(2025, 11, 30, 9).toISOString(), NOW)).toBe(
      "30 Dec 2025",
    );
  });
});

describe("dateWhen", () => {
  it("gives the date, with the year only when it isn't this one", () => {
    expect(dateWhen(at(18, 7, 4), NOW)).toBe("18 Oct");
    expect(dateWhen(new Date(2025, 11, 30, 9).toISOString(), NOW)).toBe(
      "30 Dec 2025",
    );
  });
});

describe("the inline script copies", () => {
  // RelativeDate runs each one from its source text before the first
  // paint, so it can't use anything from outside its own body.
  it.each([shortWhen, foundWhen, dayWhen, dateWhen])(
    "%o stands alone",
    (format) => {
    const copy = new Function(`return ${format.toString()}`)() as (
      iso: string,
      now: number,
    ) => string;
    expect(copy(at(17, 18, 20), NOW)).toBe(format(at(17, 18, 20), NOW));
    },
  );
});
