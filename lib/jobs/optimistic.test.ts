import { describe, expect, it } from "vitest";

import type { JobListRow } from "@/lib/dal/jobs";

import { adjustCounts, withStatus } from "./optimistic";

function row(id: string, overrides: Partial<JobListRow> = {}): JobListRow {
  return {
    id,
    title: `Role ${id}`,
    company: "Acme",
    url: `https://example.com/${id}`,
    applyUrl: null,
    status: "new",
    eligibility: "eligible",
    eligibilityQuote: null,
    eligibilityReasons: [],
    score: 80,
    scoreReasons: null,
    summary: null,
    workplace: "remote",
    places: [],
    seniority: null,
    contract: null,
    deadline: null,
    salary: null,
    stack: [],
    foundAt: "2026-10-17T07:00:00.000Z",
    postedOn: null,
    appliedAt: null,
    followUpOn: null,
    hasNotes: false,
    statusAt: "2026-10-17T07:00:00.000Z",
    tailoring: null,
    answersForYou: null,
    ...overrides,
  };
}

describe("withStatus", () => {
  it("sets the applied date when a role moves to Applied", () => {
    const now = new Date("2026-10-18T09:00:00Z");
    expect(withStatus("applied", now)(row("a")).appliedAt).toBe(
      "2026-10-18T09:00:00.000Z",
    );
    const applied = row("b", { appliedAt: "2026-10-01T09:00:00.000Z" });
    expect(withStatus("applied", now)(applied).appliedAt).toBe(
      "2026-10-01T09:00:00.000Z",
    );
  });

  it("dates the change, unless the status stays the same", () => {
    const now = new Date("2026-10-18T09:00:00Z");
    expect(withStatus("shortlisted", now)(row("a")).statusAt).toBe(
      "2026-10-18T09:00:00.000Z",
    );
    expect(withStatus("new", now)(row("a")).statusAt).toBe(
      "2026-10-17T07:00:00.000Z",
    );
  });
});

describe("adjustCounts", () => {
  const counts = { readyToSend: 2, inProgress: 18, yourTurn: 1 };

  it("counts a role being worked on once it's shortlisted", () => {
    const match = row("a");
    expect(
      adjustCounts(counts, match, withStatus("shortlisted")(match)),
    ).toEqual({ ...counts, inProgress: 19 });
  });

  it("takes a sent kit out of the ready count", () => {
    const ready = row("a", { status: "ready" });
    expect(adjustCounts(counts, ready, withStatus("applied")(ready))).toEqual({
      ...counts,
      readyToSend: 1,
    });
    expect(adjustCounts(counts, ready, withStatus("rejected")(ready))).toEqual({
      readyToSend: 1,
      inProgress: 17,
      yourTurn: 1,
    });
  });

  it("never goes below zero", () => {
    const ready = row("a", { status: "ready" });
    const none = { readyToSend: 0, inProgress: 0, yourTurn: 0 };
    expect(adjustCounts(none, ready, withStatus("skipped")(ready))).toEqual(
      none,
    );
  });
});
