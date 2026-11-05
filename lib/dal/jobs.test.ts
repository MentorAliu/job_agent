import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { application, event, job } from "@/db/schema";

// A fake Drizzle client that records writes. Only the query shapes these
// functions use are implemented.
type Write = {
  kind: "update" | "insert" | "delete";
  table: unknown;
  values?: unknown;
  onConflict?: "nothing" | { set: unknown };
};
let writes: Write[] = [];
let lockedRows: Record<string, unknown>[] = [];
let updatedRows: { id: string }[] = [];
/** The role's ready documents, newest version first. */
let documentRows: { id: string; kind: string; version: number }[] = [];
/** The role's latest timeline event. */
let eventRows: Record<string, unknown>[] = [];

function record(write: Write) {
  writes.push(write);
  return write;
}

const fakeDb: {
  select: () => unknown;
  update: (table: unknown) => unknown;
  insert: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
  transaction: <T>(run: (tx: unknown) => Promise<T>) => Promise<T>;
} = {
  select: () => ({
    from: () => ({
      where: () => ({
        for: async () => lockedRows,
        orderBy: () =>
          Object.assign(Promise.resolve(documentRows), {
            limit: async () => eventRows,
          }),
      }),
    }),
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: () => {
        record({ kind: "update", table, values });
        return Object.assign(Promise.resolve(), {
          returning: async () => updatedRows,
        });
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      const write = record({ kind: "insert", table, values });
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: async () => {
          write.onConflict = "nothing";
        },
        onConflictDoUpdate: async ({ set }: { set: unknown }) => {
          write.onConflict = { set };
        },
        returning: async () => [{ id: EVENT_ID }],
      });
    },
  }),
  delete: (table: unknown) => ({
    where: async () => {
      record({ kind: "delete", table });
    },
  }),
  transaction: async (run) => run(fakeDb),
};

const getCurrentUser = vi.fn(async () => ({ id: "u1" }));

vi.mock("./db", () => ({ db: fakeDb }));
vi.mock("./session", () => ({ getCurrentUser: () => getCurrentUser() }));
// The time zone setup saved: Montenegro's.
vi.mock("@/lib/pipeline/setup", () => ({
  readOwnerTimeZone: async () => "Europe/Belgrade",
}));

const { changeJobStatus, JobNotFoundError } = await import("./jobs");

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const EVENT_ID = "7a1d2c3b-4e5f-4a6b-9c8d-1e2f3a4b5c6d";

beforeEach(() => {
  writes = [];
  lockedRows = [];
  updatedRows = [{ id: JOB_ID }];
  documentRows = [];
  eventRows = [];
  getCurrentUser.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("changeJobStatus", () => {
  it("sets the status and adds it to the timeline with the reason", async () => {
    lockedRows = [{ status: "new" }];
    expect(
      await changeJobStatus({
        jobId: JOB_ID,
        status: "skipped",
        reason: "Pay too low",
      }),
    ).toEqual({ from: "new", to: "skipped", eventId: EVENT_ID });

    expect(getCurrentUser).toHaveBeenCalledOnce();
    expect(writes).toEqual([
      { kind: "update", table: job, values: { status: "skipped" } },
      {
        kind: "insert",
        table: event,
        values: {
          jobId: JOB_ID,
          type: "status_changed",
          payload: { from: "new", to: "skipped", reason: "Pay too low" },
        },
      },
      // Skipping is before applying, so an applied date with no documents goes.
      { kind: "delete", table: application },
    ]);
  });

  it("records the applied date when a role moves to Applied", async () => {
    lockedRows = [{ status: "ready", followUpOn: null }];
    await changeJobStatus({ jobId: JOB_ID, status: "applied", reason: "" });

    const [, timeline, applied] = writes;
    expect(timeline?.values).toMatchObject({
      payload: { from: "ready", to: "applied", reason: null },
    });
    expect(applied).toMatchObject({
      kind: "insert",
      table: application,
      values: {
        jobId: JOB_ID,
        appliedAt: expect.any(Date),
        cvDocumentId: null,
        letterDocumentId: null,
        answersDocumentId: null,
      },
    });
  });

  it("records the exact document versions sent and a follow-up 7 days later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T22:30:00Z"));
    lockedRows = [{ status: "ready", followUpOn: "2026-10-20" }];
    documentRows = [
      { id: "doc-cv-2", kind: "cv", version: 2 },
      { id: "doc-letter-1", kind: "cover_letter", version: 1 },
      { id: "doc-cv-1", kind: "cv", version: 1 },
      { id: "doc-answers-1", kind: "answers", version: 1 },
    ];
    await changeJobStatus({ jobId: JOB_ID, status: "applied", reason: "" });

    const sent = {
      appliedAt: new Date("2026-10-18T22:30:00Z"),
      cvDocumentId: "doc-cv-2",
      letterDocumentId: "doc-letter-1",
      answersDocumentId: "doc-answers-1",
    };
    expect(writes.slice(2)).toEqual([
      {
        kind: "insert",
        table: application,
        values: { jobId: JOB_ID, ...sent },
        // Applying again after moving back replaces the old record.
        onConflict: { set: sent },
      },
      {
        kind: "insert",
        table: event,
        values: {
          jobId: JOB_ID,
          type: "documents_sent",
          payload: {
            documents: [
              { kind: "cv", version: 2 },
              { kind: "cover_letter", version: 1 },
              { kind: "answers", version: 1 },
            ],
          },
        },
      },
      // 22:30 UTC is already the 19th in Montenegro, so the follow-up is the 26th.
      { kind: "update", table: job, values: { followUpOn: "2026-10-26" } },
      {
        kind: "insert",
        table: event,
        values: {
          jobId: JOB_ID,
          type: "follow_up_set",
          payload: { on: "2026-10-26" },
        },
      },
    ]);
  });

  it("keeps the first record when a role moves back to Applied from later on", async () => {
    lockedRows = [{ status: "interviewing", followUpOn: null }];
    documentRows = [{ id: "doc-cv-3", kind: "cv", version: 3 }];
    await changeJobStatus({ jobId: JOB_ID, status: "applied", reason: "" });

    expect(writes.slice(2)).toEqual([
      {
        kind: "insert",
        table: application,
        values: expect.objectContaining({ cvDocumentId: "doc-cv-3" }),
        onConflict: "nothing",
      },
    ]);
  });

  it("keeps the applied date when an application moves on", async () => {
    lockedRows = [{ status: "applied" }];
    await changeJobStatus({
      jobId: JOB_ID,
      status: "interviewing",
      reason: "",
    });
    expect(writes.map((write) => write.table)).toEqual([job, event]);
  });

  it("writes nothing when the status is the same", async () => {
    lockedRows = [{ status: "shortlisted" }];
    expect(
      await changeJobStatus({
        jobId: JOB_ID,
        status: "shortlisted",
        reason: "Good pay",
      }),
    ).toEqual({ from: "shortlisted", to: "shortlisted", eventId: null });
    expect(writes).toEqual([]);
  });

  it("throws JobNotFoundError for a role that has gone", async () => {
    await expect(
      changeJobStatus({ jobId: JOB_ID, status: "applied", reason: "" }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
    expect(writes).toEqual([]);
  });
});
