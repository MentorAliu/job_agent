import { describe, expect, it } from "vitest";

import type { SearchBlock } from "@/lib/pipeline/runs";
import {
  emptyRunStats,
  type RunStats,
  type RunStatus,
} from "@/lib/schemas/job";
import { newTailorState, type TailorState } from "@/lib/schemas/tailor";

import { topBarPollInterval, WORK_POLL_MS } from "./queries";
import {
  AFTER_SEARCH_MS,
  claudeWorking,
  kitsTodayLabel,
  nextStep,
  searchHref,
  searchLabel,
  searchStatus,
  type TopBarView,
} from "./top-bar";

const progress: RunStats = {
  ...emptyRunStats(),
  stage: "extracting",
  read: 3,
  toRead: 40,
};
const run = (id: string, status: RunStatus) => ({
  id,
  status,
  stats: status === "running" ? progress : emptyRunStats(),
});
const succeeded = run("r1", "succeeded");
const running = run("r2", "running");
const failed = run("r3", "failed");
const budget: SearchBlock = {
  cause: "budget",
  reason: "This month's budget is spent.",
};
const setup: SearchBlock = { cause: "setup", reason: "Save your profile." };

const base = {
  latest: succeeded,
  block: null,
  dailyRunOn: true,
  hour: 12,
  kitsToday: 1,
};

describe("searchStatus", () => {
  it("is on with the next daily search when nothing is wrong", () => {
    expect(searchStatus(base)).toEqual({
      state: "on",
      runId: null,
      stats: null,
      nextSearch: "tomorrow",
      reason: null,
      kitsToday: 1,
    });
  });

  it("says the next search is today before 07:00", () => {
    expect(searchStatus({ ...base, hour: 6 }).nextSearch).toBe("today");
    expect(searchStatus({ ...base, hour: 7 }).nextSearch).toBe("tomorrow");
  });

  it("follows a search that's going, whatever else holds", () => {
    expect(
      searchStatus({
        ...base,
        latest: running,
        block: budget,
        dailyRunOn: false,
      }),
    ).toMatchObject({
      state: "searching",
      runId: "r2",
      stats: progress,
      nextSearch: null,
    });
  });

  it("puts setup before the budget, the budget before the daily search, and that before a failure", () => {
    expect(searchStatus({ ...base, block: setup })).toMatchObject({
      state: "setup",
      reason: "Save your profile.",
      nextSearch: null,
    });
    expect(
      searchStatus({ ...base, block: budget, dailyRunOn: false }),
    ).toMatchObject({ state: "budget", reason: budget.reason });
    expect(
      searchStatus({ ...base, latest: failed, dailyRunOn: false }),
    ).toMatchObject({ state: "off", nextSearch: null, runId: null });
  });

  it("points at the failed search, with the next try", () => {
    expect(searchStatus({ ...base, latest: failed })).toMatchObject({
      state: "failed",
      runId: "r3",
      nextSearch: "tomorrow",
    });
  });

  it("is on before the first search", () => {
    expect(searchStatus({ ...base, latest: null }).state).toBe("on");
  });
});

describe("nextStep", () => {
  const acme = { jobId: "j1", company: "Acme" };
  const prezly = { jobId: "j2", company: "Prezly" };

  it("puts a reply before a kit", () => {
    expect(nextStep(acme, prezly)).toEqual({
      kind: "reply",
      jobId: "j1",
      company: "Acme",
    });
  });

  it("sends a kit when no company is waiting", () => {
    expect(nextStep(null, prezly)).toEqual({
      kind: "apply",
      jobId: "j2",
      company: "Prezly",
    });
  });

  it("has nothing when nothing waits", () => {
    expect(nextStep(null, null)).toEqual({ kind: "none" });
  });
});

describe("the search's line", () => {
  it("says when the next search runs", () => {
    expect(searchLabel(searchStatus(base))).toEqual({
      title: "Daily search on",
      detail: "Next tomorrow at 07:00",
    });
    expect(
      searchLabel(searchStatus({ ...base, latest: failed, hour: 3 })),
    ).toEqual({
      title: "Last search failed",
      detail: "Next try today at 07:00",
    });
  });

  it("leads to the run, or to where the block is fixed", () => {
    expect(searchHref(searchStatus(base))).toBe("/runs");
    expect(searchHref(searchStatus({ ...base, latest: running }))).toBe(
      "/runs/r2",
    );
    expect(searchHref(searchStatus({ ...base, latest: failed }))).toBe(
      "/runs/r3",
    );
    expect(searchHref(searchStatus({ ...base, block: setup }))).toBe("/");
    expect(searchHref(searchStatus({ ...base, block: budget }))).toBe(
      "/settings",
    );
    expect(searchHref(searchStatus({ ...base, dailyRunOn: false }))).toBe(
      "/settings",
    );
  });

  it("counts the day's kits against the daily limit", () => {
    expect(kitsTodayLabel(0)).toBe("0 of 3 kits today");
    expect(kitsTodayLabel(3)).toBe("3 of 3 kits today");
    expect(kitsTodayLabel(4)).toBe("4 kits today");
  });
});

describe("claudeWorking", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const idle = { latest: null, kits: [], cvs: [], reads: 0 };
  const ended = (status: RunStatus, ms: number) => ({
    status,
    finishedAt: ago(ms).toISOString(),
  });
  const kit = (status: TailorState["status"], ms: number): TailorState => ({
    ...newTailorState(["cv"], null, ago(ms)),
    status,
  });

  it("is idle with nothing going", () => {
    expect(claudeWorking(idle, now)).toBe(false);
  });

  it("keeps watching a moment after a search ends, for its kits", () => {
    for (const status of ["succeeded", "stopped"] as const) {
      expect(
        claudeWorking({ ...idle, latest: ended(status, 5_000) }, now),
      ).toBe(true);
      expect(
        claudeWorking({ ...idle, latest: ended(status, AFTER_SEARCH_MS) }, now),
      ).toBe(false);
    }
  });

  it("leaves the search going now to the run's own polling", () => {
    expect(
      claudeWorking(
        { ...idle, latest: { status: "running", finishedAt: null } },
        now,
      ),
    ).toBe(false);
  });

  it("counts kits being made, but not lost ones", () => {
    expect(
      claudeWorking({ ...idle, kits: [kit("running", 60_000)] }, now),
    ).toBe(true);
    expect(claudeWorking({ ...idle, kits: [kit("queued", 60_000)] }, now)).toBe(
      true,
    );
    expect(
      claudeWorking({ ...idle, kits: [kit("queued", 20 * 60_000)] }, now),
    ).toBe(false);
    expect(
      claudeWorking({ ...idle, kits: [kit("running", 2 * 3_600_000)] }, now),
    ).toBe(false);
  });

  it("counts CVs being built, but not lost ones", () => {
    expect(
      claudeWorking(
        { ...idle, cvs: [{ status: "writing", createdAt: ago(60_000) }] },
        now,
      ),
    ).toBe(true);
    expect(
      claudeWorking(
        { ...idle, cvs: [{ status: "checking", createdAt: ago(3_600_000) }] },
        now,
      ),
    ).toBe(false);
  });

  it("counts emails and CVs being read", () => {
    expect(claudeWorking({ ...idle, reads: 1 }, now)).toBe(true);
  });
});

describe("topBarPollInterval", () => {
  // Only `working` decides it.
  const view = (working: boolean) => ({ working }) as TopBarView;

  it("checks back only while Claude works", () => {
    expect(topBarPollInterval(view(true))).toBe(WORK_POLL_MS);
    expect(topBarPollInterval(view(false))).toBe(false);
    expect(topBarPollInterval(undefined)).toBe(false);
  });
});
