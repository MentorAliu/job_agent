import { describe, expect, it } from "vitest";

import type { MonthActivity } from "@/lib/dal/spend";

import { formatBudget, formatCost, monthPace } from "./run-labels";

function activity(spentUsd: number): MonthActivity {
  return {
    limits: { monthlyUsd: 20, runUsd: 1 },
    monthStart: "2026-10-01T00:00:00.000Z",
    nextMonthStart: "2026-11-01T00:00:00.000Z",
    spentUsd,
    costs: { searching: spentUsd, kits: 0, cv: 0, email: 0, checks: 0 },
    searches: { started: 3, failed: 0, stopped: 0 },
    kits: 0,
  };
}

describe("formatCost", () => {
  it("shows a tenth of a cent for small amounts", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.034)).toBe("$0.034");
    expect(formatCost(3.421)).toBe("$3.42");
  });
});

describe("formatBudget", () => {
  it("leaves the cents off a whole-dollar budget", () => {
    expect(formatBudget(20)).toBe("$20");
    expect(formatBudget(0)).toBe("$0");
    expect(formatBudget(12.5)).toBe("$12.50");
  });
});

describe("monthPace", () => {
  it("projects the month from the spend per day so far", () => {
    // 18 days in, $1.80 spent: $0.10 a day for 31 days.
    const pace = monthPace(activity(1.8), new Date("2026-10-19T00:00:00Z"));
    expect(pace).toBeCloseTo(3.1);
  });

  it("waits for two days of spend before guessing", () => {
    expect(monthPace(activity(0.5), new Date("2026-10-02T12:00:00Z"))).toBe(
      null,
    );
    expect(monthPace(activity(0), new Date("2026-10-19T00:00:00Z"))).toBe(null);
  });
});
