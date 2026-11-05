import { describe, expect, it, vi } from "vitest";

import type { engineCheck } from "@/db/schema";
import { CHECK_LOST_AFTER_MS, LOST_CHECK_MESSAGE } from "@/lib/schemas/setup";

vi.mock("./db", () => ({ db: {} }));
vi.mock("./session", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/pipeline/engine-check", () => ({ failEngineCheck: vi.fn() }));

const { engineCheckView } = await import("./engine-check");

type CheckRow = typeof engineCheck.$inferSelect;

const CREATED = new Date("2026-11-05T10:00:00.000Z");

const row = (overrides: Partial<CheckRow> = {}): CheckRow =>
  ({
    id: "c1",
    engine: "claude_api",
    status: "passed",
    failure: null,
    message: null,
    model: "claude-haiku-5-5",
    durationMs: 1200,
    createdAt: CREATED,
    finishedAt: new Date("2026-11-05T10:00:01.200Z"),
    ...overrides,
  }) as CheckRow;

describe("engineCheckView", () => {
  it("shows a finished check as it was saved", () => {
    expect(engineCheckView(row())).toEqual({
      id: "c1",
      engine: "claude_api",
      status: "passed",
      failure: null,
      message: null,
      model: "claude-haiku-5-5",
      durationMs: 1200,
      createdAt: "2026-11-05T10:00:00.000Z",
      finishedAt: "2026-11-05T10:00:01.200Z",
    });
  });

  it("keeps a known failure and drops one it doesn't know", () => {
    const refused = row({
      status: "failed",
      failure: "login",
      message: "The Claude API refused the key.",
    });
    expect(engineCheckView(refused)).toMatchObject({
      failure: "login",
      message: "The Claude API refused the key.",
    });
    expect(
      engineCheckView(row({ status: "failed", failure: "gremlins" })).failure,
    ).toBeNull();
  });

  it("leaves a check running while the worker can still answer", () => {
    const running = row({ status: "running", finishedAt: null });
    const now = CREATED.getTime() + CHECK_LOST_AFTER_MS;
    expect(engineCheckView(running, now).status).toBe("running");
  });

  it("calls a check the worker never finished lost", () => {
    const later = CREATED.getTime() + CHECK_LOST_AFTER_MS + 1;
    for (const status of ["queued", "running"] as const) {
      expect(
        engineCheckView(row({ status, finishedAt: null }), later),
      ).toMatchObject({
        status: "failed",
        failure: "worker",
        message: LOST_CHECK_MESSAGE,
      });
    }
    // A finished check is never lost, however old.
    expect(engineCheckView(row(), later).status).toBe("passed");
  });
});
