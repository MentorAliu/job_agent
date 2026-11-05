import { describe, expect, it } from "vitest";

import type { SalaryView } from "@/lib/dal/jobs";

import {
  formatLevel,
  formatSalaryShort,
  formatShortDay,
  formatWhere,
  matchLabel,
  postingSite,
} from "./labels";

describe("formatWhere", () => {
  it("names up to two places and counts the rest", () => {
    expect(formatWhere("remote", [])).toBe("Remote");
    expect(formatWhere("remote", ["Europe"])).toBe("Remote, Europe");
    expect(formatWhere("hybrid", ["Berlin", "Vienna", "Zagreb", "Sofia"])).toBe(
      "Hybrid, Berlin, Vienna +2",
    );
  });

  it("says when the workplace isn't known", () => {
    expect(formatWhere(null, [])).toBe("Workplace unclear");
  });
});

describe("formatLevel", () => {
  it("joins the seniority and contract it knows", () => {
    expect(formatLevel("senior", "full_time")).toBe("Senior · Full-time");
    expect(formatLevel("lead", "unclear")).toBe("Lead");
    expect(formatLevel(null, "contract")).toBe("Contract");
    expect(formatLevel("unclear", null)).toBeNull();
  });
});

describe("matchLabel", () => {
  it("uses the scoring prompt's bands", () => {
    expect(matchLabel(80)).toBe("Strong match");
    expect(matchLabel(79)).toBe("Partial match");
    expect(matchLabel(50)).toBe("Partial match");
    expect(matchLabel(49)).toBe("Weak match");
  });
});

describe("postingSite", () => {
  it("names the job board without its subdomain", () => {
    expect(postingSite("https://boards.greenhouse.io/acme/jobs/1")).toBe(
      "greenhouse.io",
    );
    expect(postingSite("https://jobs.lever.co/acme/1")).toBe("lever.co");
    expect(postingSite("https://www.acme.com/careers")).toBe("acme.com");
  });

  it("gives nothing for a broken URL", () => {
    expect(postingSite("not a url")).toBeNull();
  });
});

describe("formatShortDay", () => {
  it("leaves the year off days in this year", () => {
    expect(formatShortDay("2026-11-02", "2026-10-18")).toBe("2 Nov");
    expect(formatShortDay("2027-01-05", "2026-10-18")).toBe("5 Jan 2027");
  });
});

describe("formatSalaryShort", () => {
  const salary = (overrides: Partial<SalaryView>): SalaryView => ({
    min: 80000,
    max: 95000,
    currency: "EUR",
    period: "year",
    ...overrides,
  });

  it("writes a range with one unit and the currency's symbol", () => {
    expect(formatSalaryShort(salary({}))).toBe("€80–95K");
    expect(formatSalaryShort(salary({ currency: "USD", min: 100000, max: 1200000 }))).toBe(
      "$100K–1.2M",
    );
  });

  it("gives one amount when there's only one", () => {
    expect(formatSalaryShort(salary({ min: null }))).toBe("€95K");
    expect(formatSalaryShort(salary({ min: 95000 }))).toBe("€95K");
  });

  it("names a currency without a symbol, and pay that isn't yearly", () => {
    expect(formatSalaryShort(salary({ currency: "CHF", min: 120000, max: 120000 }))).toBe(
      "CHF 120K",
    );
    expect(
      formatSalaryShort(salary({ currency: "USD", min: 45, max: 60, period: "hour" })),
    ).toBe("$45–60/hr");
  });
});
