import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import recorded from "@/test/fixtures/claude/check-engine-response.json";
import { fakeAnthropic, type RecordedResponse } from "@/test/fake-anthropic";

import { BudgetExceededError } from "./budget";
import { CliEngineError, usageFrom, type CliTask } from "./cli/task";

const setup = {
  stage: "check_engine" as const,
  model: "claude-haiku-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
  webSearchPer1k: 10,
};
const recordLlmCall = vi.fn(async () => 0.0002);
const assertWithinBudget = vi.fn(async () => {});
const runCliTasks = vi.fn();
const runOnOpenAi = vi.fn();

vi.mock("./llm-call", () => ({
  getStageSetup: async () => setup,
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: (...args: unknown[]) =>
    assertWithinBudget(...(args as [])),
}));
vi.mock("./cli/run", () => ({
  runCliTasks: (...args: unknown[]) => runCliTasks(...args),
}));
vi.mock("./openai-api", () => ({
  runOnOpenAi: (...args: unknown[]) => runOnOpenAi(...args),
}));

const { checkEngine, CHECK_ENGINE_SYSTEM_PROMPT } =
  await import("./check-engine");

/** The API's error body, as it sends one. */
const apiError = (
  status: number,
  type: string,
  message: string,
): RecordedResponse => ({
  requestId: `req_error_${status}`,
  status,
  body: { type: "error", error: { type, message } },
});

/** The recorded reply with other text in it. */
const replying = (text: string): RecordedResponse => ({
  ...recorded,
  body: { ...recorded.body, content: [{ type: "text", text }] },
});

describe("checkEngine on the Claude API", () => {
  beforeEach(() => {
    recordLlmCall.mockClear();
    assertWithinBudget.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("passes on the recorded answer, made the way the agents call, and logs it", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    const result = await checkEngine("claude_api", client);

    expect(result).toEqual({ ok: true, model: "claude-haiku-5-5" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/v1/messages");
    expect(requests[0].body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 64,
      system: CHECK_ENGINE_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema" } },
    });
    expect(assertWithinBudget).toHaveBeenCalledTimes(1);
    expect(recordLlmCall).toHaveBeenCalledWith(
      setup,
      expect.objectContaining({ input_tokens: 212, output_tokens: 6 }),
      recorded.requestId,
    );
  });

  it("fails when the answer isn't the JSON the agents need", async () => {
    const { client } = fakeAnthropic([replying("Sure! Here you go.")]);
    const result = await checkEngine("claude_api", client);
    expect(result).toMatchObject({ ok: false, failure: "failed" });
    expect(recordLlmCall).toHaveBeenCalledTimes(1);
  });

  it("says when there's no key yet, without calling the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { client, requests } = fakeAnthropic([recorded]);
    expect(await checkEngine("claude_api", client)).toEqual({
      ok: false,
      failure: "setup",
      message: "There's no Claude API key yet. Paste one first.",
    });
    expect(requests).toHaveLength(0);
  });

  it("stops at the budget before the call", async () => {
    assertWithinBudget.mockRejectedValueOnce(
      new BudgetExceededError("monthly", "This month's budget is used up."),
    );
    const { client, requests } = fakeAnthropic([recorded]);
    expect(await checkEngine("claude_api", client)).toEqual({
      ok: false,
      failure: "budget",
      message: "This month's budget is used up.",
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      apiError(401, "authentication_error", "invalid x-api-key"),
      "login",
      /refused the key/,
    ],
    [
      apiError(403, "permission_error", "This key can't use this model."),
      "login",
      /This key can't use this model/,
    ],
    [apiError(429, "rate_limit_error", "Slow down."), "limit", /rate limit/],
    [
      apiError(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the Anthropic API.",
      ),
      "limit",
      /out of credit/,
    ],
    [apiError(529, "overloaded_error", "Overloaded"), "busy", /busy or down/],
    [
      apiError(404, "not_found_error", "model: claude-haiku-5-5"),
      "failed",
      /couldn't find the model/,
    ],
    [
      apiError(400, "invalid_request_error", "max_tokens: too small"),
      "failed",
      /refused the request: max_tokens: too small/,
    ],
  ])(
    "explains a %# refusal in plain words",
    async (response, failure, message) => {
      const { client } = fakeAnthropic([response]);
      const result = await checkEngine("claude_api", client);
      expect(result).toMatchObject({ ok: false, failure });
      expect(result.ok ? "" : result.message).toMatch(message);
    },
  );

  it("says when the API can't be reached", async () => {
    // No recorded response: the fake's fetch throws, as a network error does.
    const { client } = fakeAnthropic([]);
    expect(await checkEngine("claude_api", client)).toMatchObject({
      ok: false,
      failure: "busy",
    });
  });
});

describe("checkEngine on a plan's agent or the OpenAI API", () => {
  const reply = (output: unknown, model: string) => ({
    ok: true as const,
    reply: {
      output,
      usage: usageFrom({ inputTokens: 40, outputTokens: 5 }),
      model,
      requestId: "thread_1",
      webSearches: 0,
    },
  });

  beforeEach(() => {
    recordLlmCall.mockClear();
    runCliTasks.mockReset();
    runOnOpenAi.mockReset();
  });

  it("runs the same request as a task on the agent, with no fallback", async () => {
    runCliTasks.mockResolvedValueOnce([reply({ ok: true }, "gpt-5-codex")]);
    const result = await checkEngine("codex");
    expect(result).toEqual({ ok: true, model: "gpt-5-codex" });
    const [engine, tasks] = runCliTasks.mock.calls[0] as [string, CliTask[]];
    expect(engine).toBe("codex");
    expect(tasks).toHaveLength(1);
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "codex", model: "gpt-5-codex" }),
      expect.objectContaining({ input_tokens: 40 }),
      "thread_1",
      { engine: "codex" },
    );
  });

  it("passes on the agent's failure as it is", async () => {
    runCliTasks.mockResolvedValueOnce([
      {
        ok: false,
        error: new CliEngineError(
          "claude_code",
          "login",
          "Claude Code's token has expired.",
        ),
      },
    ]);
    expect(await checkEngine("claude_code")).toEqual({
      ok: false,
      failure: "login",
      message: "Claude Code's token has expired.",
    });
    expect(recordLlmCall).not.toHaveBeenCalled();
  });

  it("fails an answer that doesn't fit, and one that never came", async () => {
    runCliTasks.mockResolvedValueOnce([reply({ fine: "yes" }, "sonnet")]);
    expect(await checkEngine("claude_code")).toMatchObject({
      ok: false,
      failure: "failed",
    });
    runCliTasks.mockResolvedValueOnce([]);
    expect(await checkEngine("claude_code")).toEqual({
      ok: false,
      failure: "failed",
      message: "Claude Code gave no answer.",
    });
  });

  it("checks the OpenAI API at the OpenAI model's prices", async () => {
    runOnOpenAi.mockImplementationOnce(async (stageSetup) => [
      reply({ ok: true }, stageSetup.openAi.model),
    ]);
    const result = await checkEngine("openai_api");
    expect(result.ok).toBe(true);
    const [stageSetup] = runOnOpenAi.mock.calls[0] as [
      { engine: string; openAi?: { model: string } },
    ];
    expect(stageSetup.engine).toBe("openai_api");
    expect(stageSetup.openAi?.model).toBeTruthy();
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        model: stageSetup.openAi?.model,
        price: DEFAULT_PRICE_TABLE.models[stageSetup.openAi?.model ?? ""],
      }),
      expect.anything(),
      "thread_1",
      { engine: "openai_api" },
    );
  });
});
