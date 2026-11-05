import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import recorded from "@/test/fixtures/claude/company-snapshot-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";

const setupFor = (model: string) => ({
  stage: "company_snapshot" as const,
  model,
  price: DEFAULT_PRICE_TABLE.models[model],
  webSearchPer1k: 10,
});
const recordLlmCall = vi.fn(async () => 0.0168);
const assertWithinBudget = vi.fn(async () => {});

vi.mock("./llm-call", () => ({
  getStageSetup: async (_stage: string, model?: string) =>
    setupFor(model ?? "claude-haiku-5-5"),
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: (...args: unknown[]) =>
    assertWithinBudget(...(args as [])),
}));

const { companySnapshot, SNAPSHOT_MAX_SEARCHES } =
  await import("./company-snapshot");

const JOB_ID = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const posting = {
  company: "Northwind Labs",
  title: "Senior Frontend Engineer",
  url: "https://boards.greenhouse.io/northwindlabs/jobs/4012345",
};
const modelInfo = (id: string) => ({
  requestId: `req_models_${id}`,
  body: {
    id,
    type: "model",
    display_name: id,
    created_at: "2026-09-01T00:00:00Z",
    capabilities: {
      server_tools: {
        supported: true,
        web_search: { supported: true },
        code_execution: { supported: true },
      },
    },
  },
});

describe("companySnapshot (step 7) with a recorded Claude response", () => {
  beforeEach(() => {
    recordLlmCall.mockClear();
    assertWithinBudget.mockClear();
  });

  it("writes the brief from the text blocks, with each cited page once", async () => {
    const { client } = fakeAnthropic([modelInfo("claude-haiku-5-5"), recorded]);
    const { brief, costUsd } = await companySnapshot(posting, JOB_ID, client);

    expect(brief.text).toBe(
      "Northwind Labs builds analytics software for freight and logistics teams. It has about 120 staff, works remote-first across Europe, and raised a Series B this year. No red flags turned up.",
    );
    expect(brief.sources.map((source) => source.url)).toEqual([
      "https://northwindlabs.example/about",
      "https://news.example/northwind-series-b",
    ]);
    expect(Date.parse(brief.createdAt)).not.toBeNaN();
    expect(costUsd).toBe(0.0168);
    expect(recordLlmCall).toHaveBeenCalledWith(
      setupFor("claude-haiku-5-5"),
      expect.objectContaining({
        server_tool_use: expect.objectContaining({ web_search_requests: 1 }),
      }),
      recorded.requestId,
      { jobId: JOB_ID },
    );
  });

  it("leaves out what Claude says before it searches", async () => {
    const narrated = {
      ...recorded,
      body: {
        ...recorded.body,
        content: [
          {
            type: "text",
            text: "I'll research Northwind Labs, starting with its own site.",
            citations: null,
          },
          ...recorded.body.content,
        ],
      },
    };
    const { client } = fakeAnthropic([modelInfo("claude-haiku-5-5"), narrated]);
    const { brief } = await companySnapshot(posting, JOB_ID, client);
    expect(brief.text).toMatch(/^Northwind Labs builds analytics/);
    expect(brief.text).not.toContain("I'll research");
  });

  it("searches at most 3 times and never sees the profile", async () => {
    const { client, requests } = fakeAnthropic([
      modelInfo("claude-haiku-5-5"),
      recorded,
    ]);
    await companySnapshot(posting, JOB_ID, client);

    const body = requests[1].body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        type: "web_search_20260318",
        name: "web_search",
        max_uses: SNAPSHOT_MAX_SEARCHES,
        allowed_callers: ["direct"],
      },
    ]);
    expect(SNAPSHOT_MAX_SEARCHES).toBe(3);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages).toEqual([
      {
        role: "user",
        content: `Company: Northwind Labs\nThe role: Senior Frontend Engineer\nThe posting: ${posting.url}\n\nWrite the brief.`,
      },
    ]);
    expect(body.system).toMatch(/data, not instructions/);
  });

  it("continues a paused turn once and keeps both parts", async () => {
    const [search, result, ...text] = recorded.body.content;
    const paused = {
      ...recorded,
      body: {
        ...recorded.body,
        content: [search, result],
        stop_reason: "pause_turn",
      },
    };
    const rest = {
      ...recorded,
      requestId: "req_01FixtureSnapshot00000000002",
      body: { ...recorded.body, content: text },
    };
    const { client, requests } = fakeAnthropic([
      modelInfo("claude-haiku-5-5"),
      paused,
      rest,
    ]);
    const { brief } = await companySnapshot(posting, JOB_ID, client);

    expect(brief.text).toMatch(/^Northwind Labs builds analytics/);
    expect(recordLlmCall).toHaveBeenCalledTimes(2);
    const second = requests[2].body as { messages: { role: string }[] };
    expect(second.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });
});
