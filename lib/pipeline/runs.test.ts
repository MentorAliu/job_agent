import { describe, expect, it, vi } from "vitest";

import { emptyRunStats } from "@/lib/schemas/job";

vi.mock("@/lib/dal/db", () => ({ db: {} }));

const { isLostRun, searchBlock } = await import("./runs");

const NOW = Date.parse("2026-10-18T07:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000);

describe("isLostRun", () => {
  it("gives the Inngest server 15 minutes to start a run", () => {
    const queued = { status: "running" as const, stats: emptyRunStats() };
    expect(isLostRun({ ...queued, startedAt: minutesAgo(10) }, NOW)).toBe(
      false,
    );
    expect(isLostRun({ ...queued, startedAt: minutesAgo(16) }, NOW)).toBe(true);
  });

  it("waits up to 25 hours for a run that started, since scoring can take a day", () => {
    const scoring = {
      status: "running" as const,
      stats: emptyRunStats("scoring"),
    };
    expect(isLostRun({ ...scoring, startedAt: minutesAgo(23 * 60) }, NOW)).toBe(
      false,
    );
    expect(isLostRun({ ...scoring, startedAt: minutesAgo(26 * 60) }, NOW)).toBe(
      true,
    );
  });

  it("never calls a run that ended lost", () => {
    expect(
      isLostRun(
        {
          status: "succeeded",
          stats: emptyRunStats("done"),
          startedAt: minutesAgo(48 * 60),
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("searchBlock", () => {
  const limits = { monthlyUsd: 20, runUsd: 1 };
  const october = new Date("2026-10-18T12:00:00Z");

  it("lets a search start with budget for at least one discover call", () => {
    expect(
      searchBlock(
        [],
        { limits, monthSpendUsd: 19.9, remainingUsd: 0.1 },
        0.09,
        october,
      ),
    ).toBeNull();
  });

  it("names what to save before it looks at the budget", () => {
    expect(
      searchBlock(
        ["Save your profile.", "Save your job preferences."],
        { limits, monthSpendUsd: 20, remainingUsd: 0 },
        0.09,
        october,
      ),
    ).toEqual({
      cause: "setup",
      reason: "Save your profile. Save your job preferences.",
    });
  });

  it("blocks a new search once the monthly cap is reached, and says until when", () => {
    expect(
      searchBlock(
        [],
        { limits, monthSpendUsd: 19.95, remainingUsd: 0.05 },
        0.09,
        october,
      ),
    ).toEqual({
      cause: "budget",
      reason:
        "This month's API spend ($19.95) is at the $20.00 monthly budget, so no new search can start until 1 November. To search sooner, raise the monthly budget in Settings.",
    });
  });

  it("counts the month in UTC, so a December cap lifts on 1 January", () => {
    const block = searchBlock(
      [],
      { limits, monthSpendUsd: 20, remainingUsd: 0 },
      0.09,
      new Date("2026-12-31T23:30:00Z"),
    );
    expect(block?.reason).toContain("until 1 January.");
  });
});
