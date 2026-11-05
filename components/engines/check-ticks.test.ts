import { describe, expect, it } from "vitest";

import type { EngineCheckView } from "@/lib/schemas/setup";

import { checkTicks } from "./check-ticks";

const check = (overrides: Partial<EngineCheckView> = {}): EngineCheckView => ({
  id: "c1",
  engine: "claude_api",
  status: "passed",
  failure: null,
  message: null,
  model: "claude-haiku-5-5",
  durationMs: 1400,
  createdAt: "2026-11-05T10:00:00.000Z",
  finishedAt: "2026-11-05T10:00:01.400Z",
  ...overrides,
});

const base = {
  engine: "claude_api" as const,
  check: null,
  ready: true,
  pending: false,
  stale: false,
};

const states = (input: Parameters<typeof checkTicks>[0]) =>
  checkTicks(input).map((tick) => tick.state);

describe("checkTicks", () => {
  it("names the key for an API and the sign-in for a plan", () => {
    expect(checkTicks(base).map((tick) => tick.label)).toEqual([
      "Key found",
      "Background worker picked the check up",
      "Claude API answered",
    ]);
    expect(checkTicks({ ...base, engine: "codex" })[0].label).toBe(
      "Codex signed in",
    );
  });

  it("ticks all three once the check passed, with how long the answer took", () => {
    const ticks = checkTicks({ ...base, check: check() });
    expect(ticks.map((tick) => tick.state)).toEqual(["done", "done", "done"]);
    expect(ticks[2].label).toBe("Claude API answered in 1 s");
  });

  it("shows the worker as busy while the check waits for it", () => {
    expect(states({ ...base, pending: true })).toEqual([
      "done",
      "running",
      "waiting",
    ]);
    expect(states({ ...base, check: check({ status: "queued" }) })).toEqual([
      "done",
      "running",
      "waiting",
    ]);
  });

  it("shows the answer as busy once the worker has it", () => {
    expect(states({ ...base, check: check({ status: "running" }) })).toEqual([
      "done",
      "done",
      "running",
    ]);
  });

  it("puts a refused key on the first tick", () => {
    const refused = check({ status: "failed", failure: "login" });
    expect(states({ ...base, check: refused })).toEqual([
      "failed",
      "done",
      "failed",
    ]);
    expect(states({ ...base, ready: false })).toEqual([
      "failed",
      "waiting",
      "waiting",
    ]);
  });

  it("puts a lost check on the worker", () => {
    const lost = check({ status: "failed", failure: "worker" });
    expect(states({ ...base, check: lost })).toEqual([
      "done",
      "failed",
      "waiting",
    ]);
  });

  it("puts any other failure on the answer", () => {
    const limit = check({ status: "failed", failure: "limit" });
    expect(states({ ...base, check: limit })).toEqual([
      "done",
      "done",
      "failed",
    ]);
  });

  it("asks for a new answer when the key changed after the check passed", () => {
    expect(states({ ...base, check: check(), stale: true })).toEqual([
      "done",
      "done",
      "waiting",
    ]);
  });
});
