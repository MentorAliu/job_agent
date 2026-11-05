import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import discoverResponse from "@/test/fixtures/openai/discover-response.json";
import quotaError from "@/test/fixtures/openai/insufficient-quota-error.json";
import keyError from "@/test/fixtures/openai/invalid-key-error.json";
import refusalResponse from "@/test/fixtures/openai/refusal-response.json";

import type { CliTask } from "./cli/task";
import type { StageSetup } from "./llm-call";

const state = vi.hoisted(() => ({
  readOpenAiKey: vi.fn(async (): Promise<string | null> => "sk-proj-test"),
  noteEngineOk: vi.fn(async () => {}),
  noteEngineIssue: vi.fn(async () => {}),
}));
vi.mock("@/lib/pipeline/engine-state", () => state);

const budget = vi.hoisted(() => {
  class BudgetExceededError extends Error {}
  return {
    BudgetExceededError,
    assertWithinBudget: vi.fn<
      (estimateUsd: number, runId?: string) => Promise<void>
    >(async () => {}),
    estimateUsd: vi.fn(() => 0.01),
  };
});
vi.mock("./budget", () => budget);

const {
  checkOpenAiKey,
  openAiFailure,
  openAiRequest,
  parseOpenAiResponse,
  runOnOpenAi,
} = await import("./openai-api");

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const task: CliTask = {
  stage: "discover",
  model: "claude-haiku-5-5",
  system: "Find open postings.",
  prompt: "Search for senior frontend roles.",
  schema: {
    type: "object",
    properties: { urls: { type: "array", items: { type: "string" } } },
    required: ["urls"],
    additionalProperties: false,
  },
  effort: "low",
  webSearches: 3,
};

const setup: StageSetup = {
  stage: "discover",
  model: "claude-haiku-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
  webSearchPer1k: 10,
  engine: "openai_api",
  openAi: {
    model: "gpt-6-luna",
    price: DEFAULT_PRICE_TABLE.models["gpt-6-luna"],
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("openAiRequest", () => {
  it("asks for the task's schema, strictly, with nothing kept on OpenAI's side", () => {
    expect(openAiRequest(task, "gpt-6-luna")).toMatchObject({
      model: "gpt-6-luna",
      instructions: task.system,
      input: task.prompt,
      text: {
        format: {
          type: "json_schema",
          name: "discover",
          schema: task.schema,
          strict: true,
        },
      },
      reasoning: { effort: "low" },
      store: false,
      tools: [{ type: "web_search" }],
      max_tool_calls: 3,
    });
  });

  it("keeps a search on the step's job sites", () => {
    expect(
      openAiRequest(
        { ...task, allowedDomains: ["greenhouse.io", "lever.co"] },
        "gpt-6-luna",
      ).tools,
    ).toEqual([
      {
        type: "web_search",
        filters: { allowed_domains: ["greenhouse.io", "lever.co"] },
      },
    ]);
  });

  it("gives no tools to a step without web search", () => {
    const request = openAiRequest(
      { ...task, webSearches: undefined },
      "gpt-6.1-sol",
    );
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("max_tool_calls");
  });
});

describe("parseOpenAiResponse", () => {
  it("reads the answer, its tokens and the billed searches", () => {
    const reply = parseOpenAiResponse(discoverResponse, "gpt-6-luna");
    expect(reply.output).toEqual({
      urls: [
        "https://job-boards.greenhouse.io/northwindlabs/jobs/4000000001",
        "https://jobs.ashbyhq.com/contosohealth/2b6f7a10-0000-4000-8000-000000000001",
      ],
    });
    expect(reply.model).toBe("gpt-6-luna");
    expect(reply.requestId).toBe("resp_0a1b2c3d4e5f60718293a4b5c6d7e8f9");
    expect(reply.webSearches).toBe(2);
    // input_tokens includes the cached and newly cached tokens.
    expect(reply.usage).toMatchObject({
      input_tokens: 21_400 - 4096 - 2048,
      cache_read_input_tokens: 4096,
      cache_creation_input_tokens: 2048,
      output_tokens: 1830,
      server_tool_use: { web_search_requests: 2 },
    });
  });

  it("counts searches, not opened pages, when the billed count is missing", () => {
    const unbilled = { ...discoverResponse, tool_usage: undefined };
    expect(parseOpenAiResponse(unbilled, "gpt-6-luna").webSearches).toBe(2);
  });

  it("says why there's no answer", () => {
    expect(() => parseOpenAiResponse(refusalResponse, "gpt-6.1-sol")).toThrow(
      expect.objectContaining({
        failure: "failed",
        message: expect.stringContaining("declined"),
      }),
    );
    expect(() =>
      parseOpenAiResponse(
        {
          ...discoverResponse,
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
        "gpt-6-luna",
      ),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("max_output_tokens"),
      }),
    );
    expect(() => parseOpenAiResponse({ nope: true }, "gpt-6-luna")).toThrow(
      expect.objectContaining({ failure: "failed" }),
    );
  });
});

describe("openAiFailure", () => {
  it.each([
    [401, keyError, "login", true],
    [429, quotaError, "limit", true],
    [
      429,
      { error: { message: "Slow down", code: "rate_limit_exceeded" } },
      "limit",
      true,
    ],
    [500, null, "failed", false],
  ] as const)("HTTP %i is %s", (status, body, failure, stops) => {
    const error = openAiFailure(status, body);
    expect(error.engine).toBe("openai_api");
    expect(error.failure).toBe(failure);
    expect(error.stopsTheRest).toBe(stops);
  });

  it("tells an account out of credit from a rate limit", () => {
    expect(openAiFailure(429, quotaError).message).toContain("out of credit");
  });
});

describe("runOnOpenAi", () => {
  it("sends each task with the key, after a budget check, and notes it worked", async () => {
    // A body can be read once, so each call gets its own response.
    fetchMock.mockImplementation(async () => json(200, discoverResponse));
    const outcomes = await runOnOpenAi(setup, [task, task], "run-1");

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(budget.assertWithinBudget).toHaveBeenCalledTimes(2);
    expect(budget.assertWithinBudget).toHaveBeenCalledWith(0.01, "run-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer sk-proj-test",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-6-luna",
      store: false,
    });
    expect(state.noteEngineOk).toHaveBeenCalledWith("openai_api");
    expect(state.noteEngineIssue).not.toHaveBeenCalled();
  });

  it("makes no call without a key, and says how to add one", async () => {
    state.readOpenAiKey.mockResolvedValueOnce(null);
    const outcomes = await runOnOpenAi(setup, [task, task]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { ok: false, error: expect.objectContaining({ failure: "setup" }) },
      { ok: false, error: expect.objectContaining({ failure: "setup" }) },
    ]);
    expect(state.noteEngineIssue).toHaveBeenCalledWith(
      "openai_api",
      expect.stringContaining("paste an API key in Settings"),
    );
  });

  it("makes no call past the budget, and doesn't count it as OpenAI's issue", async () => {
    budget.assertWithinBudget.mockRejectedValueOnce(
      new budget.BudgetExceededError("This month's spend is at the budget."),
    );
    const [outcome] = await runOnOpenAi(setup, [task], "run-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      error: expect.objectContaining({ failure: "budget" }),
    });
    expect(state.noteEngineIssue).not.toHaveBeenCalled();
  });

  it("stops after a refused key, and keeps going after one failed answer", async () => {
    fetchMock.mockResolvedValueOnce(json(500, null));
    fetchMock.mockResolvedValueOnce(json(200, discoverResponse));
    fetchMock.mockResolvedValueOnce(json(401, keyError));
    const outcomes = await runOnOpenAi(setup, [task, task, task, task]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(state.noteEngineIssue).toHaveBeenCalledWith(
      "openai_api",
      expect.stringContaining("refused the API key"),
    );
  });

  it("calls a lost connection a failed answer, not a crash", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const [outcome] = await runOnOpenAi(setup, [task]);
    expect(outcome).toEqual({
      ok: false,
      error: expect.objectContaining({
        failure: "failed",
        message: expect.stringContaining("Couldn't reach OpenAI"),
      }),
    });
  });
});

describe("checkOpenAiKey", () => {
  it("refuses only a key OpenAI says is wrong", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    expect(await checkOpenAiKey("sk-proj-good")).toBe("ok");
    fetchMock.mockResolvedValueOnce(json(401, keyError));
    expect(await checkOpenAiKey("sk-proj-bad")).toBe("refused");
    // A key restricted to the Responses API can't list models.
    fetchMock.mockResolvedValueOnce(json(403, null));
    expect(await checkOpenAiKey("sk-proj-restricted")).toBe("unknown");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await checkOpenAiKey("sk-proj-offline")).toBe("unknown");
  });
});
