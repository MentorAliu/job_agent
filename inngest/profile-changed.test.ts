import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileSearchStart } from "@/lib/pipeline/rescore";

// The function that searches again after a profile change, with the start
// decision (lib/pipeline/rescore.ts) replaced by set answers.

const answers: ProfileSearchStart[] = [];
const startProfileSearch = vi.fn(
  async (): Promise<ProfileSearchStart> =>
    answers.shift() ?? { kind: "off", reason: "No answer left." },
);

vi.mock("@/lib/pipeline/rescore", () => ({
  startProfileSearch: () => startProfileSearch(),
}));

const { ACTIVE_RUN_TRIES, ACTIVE_RUN_WAIT, searchAfterChange } =
  await import("./profile-changed");

const RUN_ID = "0b6f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

function fakeStep() {
  const ids: string[] = [];
  const sent: { name: string; data: unknown }[] = [];
  const waits: string[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      ids.push(id);
      return fn();
    },
    sleep: async (id: string, duration: string) => {
      ids.push(id);
      waits.push(duration);
    },
    sendEvent: async (id: string, payload: { name: string; data: unknown }) => {
      ids.push(id);
      sent.push(payload);
    },
  };
  return {
    step: step as unknown as Parameters<typeof searchAfterChange>[0],
    ids,
    sent,
    waits,
  };
}

beforeEach(() => {
  answers.length = 0;
  startProfileSearch.mockClear();
});

describe("searching again after a profile change", () => {
  it("starts a search when the change touches what scoring reads", async () => {
    answers.push({ kind: "created", runId: RUN_ID });
    const { step, sent } = fakeStep();

    expect(await searchAfterChange(step)).toEqual({
      kind: "created",
      runId: RUN_ID,
    });
    expect(sent).toEqual([
      expect.objectContaining({
        name: "search/run.requested",
        data: { runId: RUN_ID },
      }),
    ]);
  });

  it("does nothing more when the change doesn't need a search", async () => {
    answers.push({
      kind: "off",
      reason: "Nothing that scoring reads changed.",
    });
    const { step, sent, waits } = fakeStep();

    expect(await searchAfterChange(step)).toMatchObject({ kind: "off" });
    expect(sent).toEqual([]);
    expect(waits).toEqual([]);
  });

  it("waits for a search that's already going, then starts its own", async () => {
    answers.push(
      { kind: "active", runId: "earlier" },
      { kind: "active", runId: "earlier" },
      { kind: "created", runId: RUN_ID },
    );
    const { step, sent, waits, ids } = fakeStep();

    expect(await searchAfterChange(step)).toMatchObject({ kind: "created" });
    expect(waits).toEqual([ACTIVE_RUN_WAIT, ACTIVE_RUN_WAIT]);
    expect(sent).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stops when the running search took the change in", async () => {
    answers.push(
      { kind: "active", runId: "earlier" },
      { kind: "off", reason: "Nothing that scoring reads changed." },
    );
    const { step, sent } = fakeStep();

    expect(await searchAfterChange(step)).toMatchObject({ kind: "off" });
    expect(sent).toEqual([]);
  });

  it("gives up after about two hours of searches, leaving it to the next one", async () => {
    for (let index = 0; index < ACTIVE_RUN_TRIES; index++) {
      answers.push({ kind: "active", runId: "earlier" });
    }
    const { step, sent } = fakeStep();

    expect(await searchAfterChange(step)).toEqual({ kind: "gave_up" });
    expect(startProfileSearch).toHaveBeenCalledTimes(ACTIVE_RUN_TRIES);
    expect(sent).toEqual([]);
  });
});
