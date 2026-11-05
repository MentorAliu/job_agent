import { beforeEach, describe, expect, it, vi } from "vitest";

// The morning clock, with the setup row replaced by a value and Inngest's
// send by a fake.

const setup = vi.hoisted(() => ({
  row: { done: true, timeZone: "Europe/Belgrade" },
}));
vi.mock("@/lib/pipeline/setup", () => ({
  readClockSetup: async () => setup.row,
  readOwnerTimeZone: async () => setup.row.timeZone,
}));

const { inngest } = await import("./client");
const send = vi.spyOn(inngest, "send").mockResolvedValue({ ids: [] });

const { morningEvents, planFrom, scheduleMorningRuns, stillScheduled } =
  await import("./clock");

beforeEach(() => {
  setup.row = { done: true, timeZone: "Europe/Belgrade" };
  send.mockClear();
});

// 18:17 UTC, one of the clock's times, is 19:17 in Belgrade in November.
const evening = new Date("2026-11-05T18:17:00Z");

describe("the morning clock", () => {
  it("schedules tomorrow's runs at their times in the saved time zone", async () => {
    expect(await planFrom(evening)).toEqual({
      timeZone: "Europe/Belgrade",
      runs: [
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
      ],
    });
    // In New York it's 13:17, and its 07:00 is 17 hours away.
    setup.row = { done: true, timeZone: "America/New_York" };
    const { runs } = await planFrom(evening);
    expect(runs.find(({ job }) => job === "daily-search")).toEqual({
      job: "daily-search",
      day: "2026-11-06",
      at: "2026-11-06T12:00:00.000Z",
    });
  });

  it("schedules nothing before first-run setup is finished", async () => {
    setup.row = { done: false, timeZone: "Europe/Belgrade" };
    expect((await planFrom(evening)).runs).toEqual([]);
  });

  it("sends each run to start at its time, with an id from the job, the day and the time zone", async () => {
    const { timeZone, runs } = await planFrom(evening);
    expect(
      morningEvents(timeZone, runs).map(({ name, data, id, ts }) => ({
        name,
        data,
        id,
        ts,
      })),
    ).toEqual([
      {
        name: "schedule/listings-check.due",
        data: { day: "2026-11-06", timeZone: "Europe/Belgrade" },
        id: "check-listings-2026-11-06-Europe/Belgrade",
        ts: Date.parse("2026-11-06T05:30:00Z"),
      },
      {
        name: "schedule/daily-search.due",
        data: { day: "2026-11-06", timeZone: "Europe/Belgrade" },
        id: "daily-search-2026-11-06-Europe/Belgrade",
        ts: Date.parse("2026-11-06T06:00:00Z"),
      },
      {
        name: "schedule/no-response-check.due",
        data: { day: "2026-11-06", timeZone: "Europe/Belgrade" },
        id: "mark-no-response-2026-11-06-Europe/Belgrade",
        ts: Date.parse("2026-11-06T06:30:00Z"),
      },
    ]);
  });

  it("lets a run go ahead only in the time zone it was scheduled in", async () => {
    expect(await stillScheduled("Europe/Belgrade")).toBe(true);
    setup.row = { done: true, timeZone: "America/New_York" };
    expect(await stillScheduled("Europe/Belgrade")).toBe(false);
  });

  it("asks for a schedule when the time zone is saved, and only logs a failure", async () => {
    await scheduleMorningRuns("America/New_York");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "schedule/time-zone.saved",
        data: { timeZone: "America/New_York" },
      }),
    );

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(scheduleMorningRuns("Europe/Lisbon")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
