import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CliBox } from "./box";
import { CliEngineError, usageFrom, type CliReply, type CliTask } from "./task";

const state = vi.hoisted(() => ({
  takeLease: vi.fn(async (): Promise<string | null> => "lease-1"),
  releaseLease: vi.fn(async () => {}),
  readCodexLogin: vi.fn(async (): Promise<string | null> => "{}"),
  saveCodexLogin: vi.fn(async () => {}),
  noteEngineOk: vi.fn(async () => {}),
  noteEngineIssue: vi.fn(async () => {}),
}));
vi.mock("@/lib/pipeline/engine-state", () => state);

const agents = vi.hoisted(() => ({
  runClaudeCode: vi.fn(),
  runCodex: vi.fn(),
}));
vi.mock("./claude-code", () => ({ runClaudeCode: agents.runClaudeCode }));
vi.mock("./codex", () => ({ runCodex: agents.runCodex }));

const boxes = vi.hoisted(() => ({ started: 0, fail: null as Error | null }));
vi.mock("./box", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  withCliBox: async <T>(_engine: string, work: (box: CliBox) => Promise<T>) => {
    if (boxes.fail) throw boxes.fail;
    boxes.started++;
    return work({} as CliBox);
  },
}));

const { runCliTasks } = await import("./run");

const task = (prompt: string): CliTask => ({
  stage: "score",
  model: "claude-haiku-5-5",
  system: "Score the role.",
  prompt,
  schema: { type: "object" },
  effort: "low",
});

const reply = (output: unknown): CliReply => ({
  output,
  usage: usageFrom({ inputTokens: 10, outputTokens: 5 }),
  model: "claude-haiku-5-5",
  requestId: "session-1",
  webSearches: 0,
});

beforeEach(() => {
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token");
  boxes.started = 0;
  boxes.fail = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("runCliTasks", () => {
  it("runs every task in one sandbox and notes the engine worked", async () => {
    agents.runClaudeCode.mockImplementation(async (_box, { prompt }) =>
      reply({ prompt }),
    );
    const outcomes = await runCliTasks("claude_code", [task("a"), task("b")]);

    expect(boxes.started).toBe(1);
    expect(outcomes).toEqual([
      { ok: true, reply: reply({ prompt: "a" }) },
      { ok: true, reply: reply({ prompt: "b" }) },
    ]);
    expect(agents.runClaudeCode).toHaveBeenCalledWith(
      expect.anything(),
      task("a"),
      "oauth-token",
    );
    expect(state.noteEngineOk).toHaveBeenCalledWith("claude_code");
    expect(state.noteEngineIssue).not.toHaveBeenCalled();
    // Claude Code's token can be shared, so it takes no lease.
    expect(state.takeLease).not.toHaveBeenCalled();
  });

  it("keeps going after a task with no answer, and stops at a reached limit", async () => {
    agents.runClaudeCode
      .mockResolvedValueOnce(reply("a"))
      .mockRejectedValueOnce(
        new CliEngineError("claude_code", "failed", "no answer"),
      )
      .mockRejectedValueOnce(
        new CliEngineError("claude_code", "limit", "limit reached"),
      );
    const outcomes = await runCliTasks("claude_code", [
      task("a"),
      task("b"),
      task("c"),
      task("d"),
    ]);

    expect(agents.runClaudeCode).toHaveBeenCalledTimes(3);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    const failures = outcomes.map((outcome) =>
      outcome.ok ? null : outcome.error.failure,
    );
    expect(failures).toEqual([null, "failed", "limit", "limit"]);
    expect(state.noteEngineOk).toHaveBeenCalled();
    expect(state.noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      "limit reached",
    );
  });

  it("starts no sandbox without a sign-in", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    const outcomes = await runCliTasks("claude_code", [task("a")]);

    expect(boxes.started).toBe(0);
    expect(outcomes).toEqual([
      { ok: false, error: expect.objectContaining({ failure: "setup" }) },
    ]);
    expect(state.noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      expect.stringContaining("CLAUDE_CODE_OAUTH_TOKEN"),
    );
  });

  it("fails every task when the sandbox can't start", async () => {
    boxes.fail = new Error("quota exceeded");
    const outcomes = await runCliTasks("claude_code", [task("a"), task("b")]);

    expect(outcomes).toEqual([
      {
        ok: false,
        error: expect.objectContaining({
          failure: "sandbox",
          message: "The agent's box failed: quota exceeded",
        }),
      },
      { ok: false, error: expect.objectContaining({ failure: "sandbox" }) },
    ]);
    expect(state.noteEngineOk).not.toHaveBeenCalled();
  });

  it("holds Codex's sign-in for the step, passes on the renewed copy and lets go", async () => {
    state.readCodexLogin.mockResolvedValueOnce('{"tokens":"v1"}');
    agents.runCodex
      .mockImplementationOnce(async (_box, _task, login, keepLogin) => {
        expect(login).toBe('{"tokens":"v1"}');
        await keepLogin('{"tokens":"v2"}');
        return reply("a");
      })
      .mockImplementationOnce(async (_box, _task, login) => {
        expect(login).toBe('{"tokens":"v2"}');
        return reply("b");
      });
    const outcomes = await runCliTasks("codex", [task("a"), task("b")]);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(state.takeLease).toHaveBeenCalledOnce();
    expect(state.saveCodexLogin).toHaveBeenCalledWith('{"tokens":"v2"}');
    expect(state.releaseLease).toHaveBeenCalledWith("codex", "lease-1");
  });

  it("gives up on Codex when another step holds its sign-in too long", async () => {
    vi.useFakeTimers();
    try {
      state.takeLease.mockResolvedValue(null);
      const outcomes = runCliTasks("codex", [task("a")]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await outcomes).toEqual([
        { ok: false, error: expect.objectContaining({ failure: "busy" }) },
      ]);
      expect(boxes.started).toBe(0);
      expect(state.releaseLease).not.toHaveBeenCalled();
    } finally {
      state.takeLease.mockResolvedValue("lease-1");
      vi.useRealTimers();
    }
  });
});
