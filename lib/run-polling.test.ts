import { describe, expect, it } from "vitest";

import { RUN_POLL_MS, runPollInterval } from "./run-polling";

describe("runPollInterval", () => {
  it("polls every 2 seconds while the run is going", () => {
    expect(runPollInterval({ status: "running" })).toBe(RUN_POLL_MS);
    expect(RUN_POLL_MS).toBe(2000);
  });

  it("stops polling once the run has ended, however it ended", () => {
    for (const status of ["succeeded", "stopped", "failed"] as const) {
      expect(runPollInterval({ status })).toBe(false);
    }
  });

  it("doesn't poll a run it couldn't load", () => {
    expect(runPollInterval(undefined)).toBe(false);
  });
});
