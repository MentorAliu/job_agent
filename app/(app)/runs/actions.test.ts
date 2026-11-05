import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateRunResult } from "@/lib/pipeline/runs";

const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

const startManualRun = vi.fn(async (): Promise<CreateRunResult> => ({
  kind: "created",
  runId: RUN_ID,
}));
const markRunFailed = vi.fn(async () => {});
const send = vi.fn(async (): Promise<{ ids: string[] }> => ({ ids: ["evt"] }));
const refresh = vi.fn();

vi.mock("@/lib/dal/runs", () => ({
  startManualRun: () => startManualRun(),
  markRunFailed: (...args: unknown[]) => markRunFailed(...(args as [])),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => send(...(args as [])) },
}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { startSearchAction } = await import("./actions");

describe("startSearchAction (Search now)", () => {
  beforeEach(() => {
    startManualRun.mockClear();
    markRunFailed.mockClear();
    send.mockClear();
    refresh.mockClear();
  });

  it("records a run and sends the event that starts it", async () => {
    expect(await startSearchAction()).toEqual({ ok: true, runId: RUN_ID });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search/run.requested",
        data: { runId: RUN_ID },
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns the run already going instead of starting another", async () => {
    startManualRun.mockResolvedValueOnce({ kind: "active", runId: RUN_ID });
    expect(await startSearchAction()).toEqual({ ok: true, runId: RUN_ID });
    expect(send).not.toHaveBeenCalled();
  });

  it("says what's missing when the search can't run yet", async () => {
    startManualRun.mockResolvedValueOnce({
      kind: "blocked",
      cause: "setup",
      reason:
        "Save your job preferences, so the search knows where you can work.",
      runId: null,
    });
    expect(await startSearchAction()).toEqual({
      ok: false,
      blocked: "setup",
      errors: {
        formErrors: [
          "Save your job preferences, so the search knows where you can work.",
        ],
        fieldErrors: {},
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("says the monthly budget is spent, so the page can link to Settings", async () => {
    const reason =
      "This month's API spend ($20.01) is at the $20.00 monthly budget, so no new search can start until 1 November. To search sooner, raise the monthly budget in Settings.";
    startManualRun.mockResolvedValueOnce({
      kind: "blocked",
      cause: "budget",
      reason,
      runId: null,
    });
    expect(await startSearchAction()).toEqual({
      ok: false,
      blocked: "budget",
      errors: { formErrors: [reason], fieldErrors: {} },
    });
    expect(send).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks the run failed when the event can't be sent", async () => {
    send.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:8288"),
    );
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const result = await startSearchAction();
    expect(result.ok).toBe(false);
    expect(markRunFailed).toHaveBeenCalledWith(
      RUN_ID,
      expect.stringContaining("Inngest server"),
    );
  });
});
