import { describe, expect, it } from "vitest";

import type { JobListRow } from "@/lib/dal/jobs";

import { followUpState, needsYou, nextStep } from "./next-step";
import { emptyStatusCounts, tabCount } from "./stages";

const TODAY = "2026-10-18";

type Row = Parameters<typeof nextStep>[0];

function row(overrides: Partial<JobListRow> = {}): Row {
  return {
    status: "applied",
    followUpOn: null,
    tailoring: null,
    answersForYou: null,
    ...overrides,
  };
}

describe("followUpState", () => {
  it("says how late a follow-up is, from its day on", () => {
    expect(followUpState(row({ followUpOn: "2026-10-16" }), TODAY)).toEqual({
      kind: "late",
      days: 2,
    });
    expect(followUpState(row({ followUpOn: TODAY }), TODAY)).toEqual({
      kind: "today",
    });
    expect(followUpState(row({ followUpOn: "2026-10-25" }), TODAY)).toEqual({
      kind: "set",
      on: "2026-10-25",
    });
    expect(followUpState(row(), TODAY)).toBeNull();
  });

  it("never counts a follow-up on a closed role as due", () => {
    expect(
      followUpState(
        row({ status: "rejected", followUpOn: "2026-10-01" }),
        TODAY,
      ),
    ).toEqual({ kind: "set", on: "2026-10-01" });
  });

  it("counts days across a month's end", () => {
    expect(followUpState(row({ followUpOn: "2026-09-29" }), TODAY)).toEqual({
      kind: "late",
      days: 19,
    });
  });
});

describe("nextStep", () => {
  it("puts a follow-up that's due first", () => {
    expect(
      nextStep(
        row({ status: "ready", followUpOn: TODAY, answersForYou: 2 }),
        TODAY,
      ),
    ).toEqual({ kind: "follow_up", late: 0 });
  });

  it("reads the apply kit before applying", () => {
    expect(
      nextStep(row({ status: "shortlisted", tailoring: "active" }), TODAY),
    ).toEqual({ kind: "tailoring" });
    expect(
      nextStep(row({ status: "shortlisted", tailoring: "failed" }), TODAY),
    ).toEqual({ kind: "tailoring_failed" });
    expect(nextStep(row({ status: "ready", answersForYou: 1 }), TODAY)).toEqual(
      { kind: "answers", count: 1 },
    );
    expect(nextStep(row({ status: "ready", answersForYou: 0 }), TODAY)).toEqual(
      { kind: "kit_ready" },
    );
    expect(nextStep(row({ status: "shortlisted" }), TODAY)).toBeNull();
  });

  it("ignores the kit once the role is applied to", () => {
    expect(
      nextStep(row({ answersForYou: 2, tailoring: "failed" }), TODAY),
    ).toBeNull();
  });

  it("waits on the owner for an offer", () => {
    expect(nextStep(row({ status: "offer" }), TODAY)).toEqual({
      kind: "offer",
    });
  });

  it("leaves tailoring to Claude", () => {
    expect(needsYou({ kind: "tailoring" })).toBe(false);
    expect(needsYou({ kind: "kit_ready" })).toBe(true);
    expect(needsYou(null)).toBe(false);
  });
});

describe("tabCount", () => {
  it("adds up the counts of the tab's statuses", () => {
    const counts = emptyStatusCounts();
    counts.applied = { count: 9, due: 2, fresh: 0 };
    counts.interviewing = { count: 2, due: 0, fresh: 0 };
    counts.offer = { count: 1, due: 1, fresh: 0 };
    counts.rejected = { count: 4, due: 0, fresh: 1 };
    counts.new = { count: 12, due: 0, fresh: 5 };

    expect(tabCount(counts, "waiting")).toBe(12);
    expect(tabCount(counts, "all")).toBe(28);
    expect(tabCount(counts, "waiting", "fresh")).toBe(5);
    expect(tabCount(counts, "all", "fresh")).toBe(6);
  });
});
