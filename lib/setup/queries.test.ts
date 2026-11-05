import { describe, expect, it } from "vitest";

import type { SetupState } from "@/lib/dal/setup";
import type { EngineCheckView } from "@/lib/schemas/setup";

import { isCheckActive, SETUP_POLL_MS, setupPollInterval } from "./queries";

const check = (status: EngineCheckView["status"]): EngineCheckView => ({
  id: "c1",
  engine: "claude_api",
  status,
  failure: null,
  message: null,
  model: null,
  durationMs: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  finishedAt: null,
});

/** Just the parts of setup's state the polling looks at. */
function state({
  check: latest = null,
  upload = null,
  atsCv = null,
}: {
  check?: EngineCheckView | null;
  upload?: "pending" | "succeeded" | "failed" | null;
  atsCv?: string | null;
}): SetupState {
  return {
    provider: { check: latest },
    cv: {
      upload: upload ? { status: upload } : null,
      atsCv: atsCv
        ? { status: atsCv, createdAt: new Date().toISOString() }
        : null,
    },
  } as unknown as SetupState;
}

describe("isCheckActive", () => {
  it("is true while the check waits for its answer", () => {
    expect(isCheckActive(check("queued"))).toBe(true);
    expect(isCheckActive(check("running"))).toBe(true);
    expect(isCheckActive(check("passed"))).toBe(false);
    expect(isCheckActive(check("failed"))).toBe(false);
    expect(isCheckActive(null)).toBe(false);
  });
});

describe("setupPollInterval", () => {
  it("polls while a check, a CV read or a CV build runs", () => {
    expect(setupPollInterval(state({ check: check("running") }))).toBe(
      SETUP_POLL_MS,
    );
    expect(setupPollInterval(state({ upload: "pending" }))).toBe(SETUP_POLL_MS);
    expect(setupPollInterval(state({ atsCv: "writing" }))).toBe(SETUP_POLL_MS);
  });

  it("stays quiet otherwise", () => {
    expect(setupPollInterval(undefined)).toBe(false);
    expect(setupPollInterval(state({}))).toBe(false);
    expect(
      setupPollInterval(
        state({ check: check("passed"), upload: "succeeded", atsCv: "ready" }),
      ),
    ).toBe(false);
    expect(setupPollInterval(state({ atsCv: "failed" }))).toBe(false);
  });
});
