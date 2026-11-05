import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_STAGE_MODELS,
  type AgentEngine,
  type PriceTable,
} from "@/lib/schemas/settings";

import { usageFrom } from "./cli/task";

const settings = vi.hoisted(() => ({
  agentEngine: "claude_api" as AgentEngine,
  prices: null as PriceTable | null,
}));
vi.mock("@/lib/pipeline/llm-call", () => ({ insertLlmCall: async () => {} }));
vi.mock("@/lib/pipeline/settings", () => ({
  readSettings: async () => ({
    models: DEFAULT_STAGE_MODELS,
    prices: settings.prices ?? DEFAULT_PRICE_TABLE,
    agentEngine: settings.agentEngine,
  }),
}));

const { getStageSetup, llmCallRow } = await import("./llm-call");
const { costUsd, tokenCounts } = await import("./cost");

const usage = usageFrom({ inputTokens: 10_000, outputTokens: 2_000 });

describe("getStageSetup", () => {
  it("names the command-line agent Settings picked, and none for the API", async () => {
    expect((await getStageSetup("tailor")).engine).toBeUndefined();
    settings.agentEngine = "codex";
    expect((await getStageSetup("tailor")).engine).toBe("codex");
  });

  it("on the OpenAI API, names the model that stands in, with its prices", async () => {
    settings.agentEngine = "openai_api";
    expect(await getStageSetup("tailor")).toMatchObject({
      engine: "openai_api",
      model: "claude-sonnet-5-5",
      openAi: {
        model: "gpt-6.1-sol",
        price: DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
      },
    });
    expect((await getStageSetup("score")).openAi?.model).toBe("gpt-6-luna");
  });

  it("prices OpenAI's models even from a price table saved before they were in it", async () => {
    settings.agentEngine = "openai_api";
    settings.prices = {
      ...DEFAULT_PRICE_TABLE,
      models: {
        "claude-sonnet-5-5": DEFAULT_PRICE_TABLE.models["claude-sonnet-5-5"],
      },
    };
    try {
      expect((await getStageSetup("tailor")).openAi?.price).toEqual(
        DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"],
      );
    } finally {
      settings.prices = null;
    }
  });
});

describe("llmCallRow", () => {
  it("logs a command-line agent's answer at $0, with its engine", async () => {
    settings.agentEngine = "claude_code";
    const setup = await getStageSetup("tailor");
    expect(
      llmCallRow(setup, usage, "session-1", { engine: "claude_code" }),
    ).toMatchObject({
      engine: "claude_code",
      costUsd: 0,
      inputTokens: 10_000,
      requestId: "session-1",
    });
  });

  it("prices an API call even when an agent was picked, since it fell back", async () => {
    settings.agentEngine = "claude_code";
    const row = llmCallRow(await getStageSetup("tailor"), usage, "req_1");
    expect(row.engine).toBe("claude_api");
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it("prices an OpenAI API answer at the stand-in model's prices", async () => {
    settings.agentEngine = "openai_api";
    const setup = await getStageSetup("tailor");
    const price = DEFAULT_PRICE_TABLE.models["gpt-6.1-sol"];
    const row = llmCallRow(
      { ...setup, model: "gpt-6.1-sol", price },
      usage,
      "resp_1",
      { engine: "openai_api" },
    );
    expect(row).toMatchObject({ engine: "openai_api", model: "gpt-6.1-sol" });
    expect(row.costUsd).toBe(costUsd(tokenCounts(usage), price, 10));
    expect(row.costUsd).toBeGreaterThan(0);
  });
});
