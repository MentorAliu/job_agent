import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import recorded from "@/test/fixtures/claude/parse-cv-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";

import type { CliOutcome } from "./cli/run";
import { CliEngineError, usageFrom, type CliTask } from "./cli/task";
import type { StageSetup } from "./llm-call";

const runCliTasks = vi.hoisted(() =>
  vi.fn<(engine: string, tasks: CliTask[]) => Promise<CliOutcome[]>>(
    async () => [],
  ),
);
const runOnOpenAi = vi.hoisted(() =>
  vi.fn<
    (
      setup: StageSetup,
      tasks: CliTask[],
      runId?: string,
    ) => Promise<CliOutcome[]>
  >(async () => []),
);
const noteEngineIssue = vi.hoisted(() => vi.fn(async () => {}));
const readOpenAiKey = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => null),
);
const recordLlmCall = vi.hoisted(() => vi.fn(async () => 0.027294));
const assertWithinBudget = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./cli/run", () => ({ runCliTasks }));
vi.mock("./openai-api", () => ({ runOnOpenAi }));
vi.mock("@/lib/pipeline/engine-state", () => ({
  noteEngineIssue,
  readOpenAiKey,
  readClaudeApiKey: async () => process.env.ANTHROPIC_API_KEY?.trim() || null,
}));
vi.mock("./llm-call", () => ({ recordLlmCall }));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget,
}));

const { NoApiKeyError } = await import("./api-key");
const { buildParseCvRequest } = await import("./parse-cv");
const { answersOnCli, sendRequest } = await import("./send");

const apiSetup: StageSetup = {
  stage: "parse_cv",
  model: "claude-sonnet-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-sonnet-5-5"],
  webSearchPer1k: 10,
};
const cliSetup: StageSetup = {
  ...apiSetup,
  engine: "claude_code",
  openAi: {
    model: "gpt-6.1-sol",
    price: DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
  },
};
const limitReached = (): CliOutcome => ({
  ok: false,
  error: new CliEngineError("claude_code", "limit", "limit reached"),
});

const request = buildParseCvRequest(
  { kind: "text", text: "Jordan Sample, Senior Frontend Engineer" },
  apiSetup.model,
);
const profile: unknown = JSON.parse(
  (recorded.body.content[0] as { text: string }).text,
);
const answered = (output: unknown): CliOutcome[] => [
  {
    ok: true,
    reply: {
      output,
      usage: usageFrom({ inputTokens: 1200, outputTokens: 900 }),
      model: "claude-sonnet-5-5",
      requestId: "session-1",
      webSearches: 0,
    },
  },
];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("sendRequest", () => {
  it("uses the agent's answer, with no API call or budget check", async () => {
    runCliTasks.mockResolvedValueOnce(answered(profile));
    const { client, requests } = fakeAnthropic([]);
    const sent = await sendRequest({
      setup: cliSetup,
      request,
      estimateUsd: 0.2,
      client,
    });

    expect(requests).toHaveLength(0);
    expect(assertWithinBudget).not.toHaveBeenCalled();
    const [engine, [task]] = runCliTasks.mock.calls[0];
    expect(engine).toBe("claude_code");
    expect(task).toMatchObject({ stage: "parse_cv", system: request.system });
    const [block] = sent.message.content;
    expect(block.type === "text" && JSON.parse(block.text)).toEqual(profile);
    expect(sent.requestId).toBe("session-1");

    await sent.record({ runId: "run-1" });
    expect(recordLlmCall).toHaveBeenCalledWith(
      cliSetup,
      expect.objectContaining({ input_tokens: 1200 }),
      "session-1",
      { runId: "run-1", engine: "claude_code" },
    );
  });

  it("falls back to the API within the budget when the agent can't answer", async () => {
    runCliTasks.mockResolvedValueOnce([
      {
        ok: false,
        error: new CliEngineError("claude_code", "limit", "limit reached"),
      },
    ]);
    const { client, requests } = fakeAnthropic([recorded]);
    const sent = await sendRequest({
      setup: cliSetup,
      request,
      estimateUsd: 0.2,
      client,
    });

    expect(requests).toHaveLength(1);
    expect(assertWithinBudget).toHaveBeenCalledWith(0.2);
    // The runner already noted why.
    expect(noteEngineIssue).not.toHaveBeenCalled();
    await sent.record();
    // An API call is logged as one, at its price.
    expect(recordLlmCall).toHaveBeenCalledWith(
      cliSetup,
      expect.anything(),
      recorded.requestId,
    );
  });

  it("falls back to the API when the answer doesn't match the schema", async () => {
    runCliTasks.mockResolvedValueOnce(answered({ basics: "Jordan" }));
    const { client, requests } = fakeAnthropic([recorded]);
    await sendRequest({ setup: cliSetup, request, estimateUsd: 0.2, client });

    expect(requests).toHaveLength(1);
    expect(noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      expect.stringContaining("didn't match the step's schema"),
    );
  });

  it("goes straight to the API when Settings picked it", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await sendRequest({
      setup: apiSetup,
      request,
      estimateUsd: 0.2,
      runId: "run-1",
      client,
    });

    expect(runCliTasks).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(assertWithinBudget).toHaveBeenCalledWith(0.2, "run-1");
  });

  it("stops with a readable reason when there's no API key to fall back on", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    runCliTasks.mockResolvedValueOnce([limitReached()]);
    const { client, requests } = fakeAnthropic([recorded]);
    const sent = sendRequest({
      setup: cliSetup,
      request,
      estimateUsd: 0.2,
      client,
    });

    await expect(sent).rejects.toBeInstanceOf(NoApiKeyError);
    await expect(sent).rejects.toThrow(
      "Claude Code couldn't run this step, and there's no API key",
    );
    expect(requests).toHaveLength(0);
  });

  it("asks for a key when Settings picked the Claude API and there's none", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { client, requests } = fakeAnthropic([recorded]);
    await expect(
      sendRequest({ setup: apiSetup, request, estimateUsd: 0.2, client }),
    ).rejects.toThrow(
      "There's no Claude API key. Add one in Settings, under Agents run on",
    );
    expect(requests).toHaveLength(0);
  });

  it("goes to the API for a request an agent can't take", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await sendRequest({
      setup: cliSetup,
      request: buildParseCvRequest(
        { kind: "pdf", anthropicFileId: "file_011CV" },
        apiSetup.model,
      ),
      estimateUsd: 0.2,
      client,
    });

    expect(runCliTasks).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      "Claude Code can't read this step's input, such as a PDF with no text.",
    );
  });
});

describe("answersOnCli", () => {
  it("keeps each answer that parses, in order", async () => {
    runCliTasks.mockResolvedValueOnce([
      ...answered({ score: 80 }),
      ...answered({ score: "high" }),
      {
        ok: false,
        error: new CliEngineError("claude_code", "failed", "no answer"),
      },
    ]);
    const tasks = Array.from({ length: 3 }, () => ({}) as CliTask);
    const answers = await answersOnCli(cliSetup, tasks, (output) => {
      const { score } = output as { score: unknown };
      if (typeof score !== "number") throw new Error("not a score");
      return score;
    });

    expect(answers.map((answer) => answer?.value ?? null)).toEqual([
      80,
      null,
      null,
    ]);
    expect(noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      "An answer didn't match the step's schema.",
    );
  });

  it("sends tasks to the OpenAI API and logs answers at its prices", async () => {
    const openAiSetup: StageSetup = {
      ...apiSetup,
      engine: "openai_api",
      openAi: {
        model: "gpt-6.1-sol",
        price: DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
      },
    };
    const [outcome] = answered({ score: 80 });
    if (!outcome.ok) throw new Error("unreachable");
    runOnOpenAi.mockResolvedValueOnce([
      { ok: true, reply: { ...outcome.reply, model: "gpt-6.1-sol" } },
    ]);
    const [answer] = await answersOnCli(
      openAiSetup,
      [{} as CliTask],
      (output) => output,
      "run-1",
    );

    expect(runCliTasks).not.toHaveBeenCalled();
    expect(runOnOpenAi).toHaveBeenCalledWith(
      openAiSetup,
      [expect.anything()],
      "run-1",
    );
    expect(answer?.setup).toMatchObject({
      model: "gpt-6.1-sol",
      price: DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
    });
    await answer?.record({ runId: "run-1" });
    expect(recordLlmCall).toHaveBeenCalledWith(
      answer?.setup,
      outcome.reply.usage,
      "session-1",
      { runId: "run-1", engine: "openai_api" },
    );
  });

  it("without a Claude API key, sends what the agent couldn't answer to the OpenAI API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    readOpenAiKey.mockResolvedValueOnce("sk-proj-key");
    runCliTasks.mockResolvedValueOnce([
      ...answered({ score: 80 }),
      limitReached(),
    ]);
    const [outcome] = answered({ score: 60 });
    if (!outcome.ok) throw new Error("unreachable");
    runOnOpenAi.mockResolvedValueOnce([
      { ok: true, reply: { ...outcome.reply, model: "gpt-6.1-sol" } },
    ]);
    const tasks = [{ prompt: "one" }, { prompt: "two" }] as CliTask[];
    const answers = await answersOnCli(cliSetup, tasks, (output) => output);

    expect(runOnOpenAi).toHaveBeenCalledWith(cliSetup, [tasks[1]], undefined);
    expect(answers.map((answer) => answer?.engine)).toEqual([
      "claude_code",
      "openai_api",
    ]);
    expect(answers[1]?.setup).toMatchObject({
      model: "gpt-6.1-sol",
      price: DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
    });
    await answers[1]?.record({ runId: "run-1" });
    expect(recordLlmCall).toHaveBeenCalledWith(
      answers[1]?.setup,
      outcome.reply.usage,
      "session-1",
      { runId: "run-1", engine: "openai_api" },
    );
  });

  it("keeps the Claude API as the fallback when the app has its key", async () => {
    runCliTasks.mockResolvedValueOnce([limitReached()]);
    const answers = await answersOnCli(
      cliSetup,
      [{} as CliTask],
      (output) => output,
    );

    expect(answers).toEqual([null]);
    expect(readOpenAiKey).not.toHaveBeenCalled();
    expect(runOnOpenAi).not.toHaveBeenCalled();
  });

  it("runs nothing without an engine", async () => {
    const answers = await answersOnCli(apiSetup, [{} as CliTask], () => 1);
    expect(answers).toEqual([null]);
    expect(runCliTasks).not.toHaveBeenCalled();
  });
});
