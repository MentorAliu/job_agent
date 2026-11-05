import { describe, expect, it } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";

import { costUsd, type TokenCounts } from "./cost";

const sonnet = DEFAULT_PRICE_TABLE.models["claude-sonnet-5-5"];
const haiku = DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"];

const counts = (overrides: Partial<TokenCounts>): TokenCounts => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  webSearches: 0,
  batch: false,
  ...overrides,
});

describe("costUsd", () => {
  it("prices Sonnet 5.5 input and output tokens", () => {
    // 4,182 × $2/M + 1,893 × $10/M
    expect(
      costUsd(counts({ inputTokens: 4182, outputTokens: 1893 }), sonnet, 10),
    ).toBe(0.027294);
  });

  it("prices cache writes by TTL and cache reads at the cache rate", () => {
    const cost = costUsd(
      counts({
        cacheCreationInputTokens: 3000,
        cacheCreation1hInputTokens: 1000,
        cacheReadInputTokens: 10_000,
      }),
      sonnet,
      10,
    );
    // 2,000 × $2.50/M + 1,000 × $4/M + 10,000 × $0.10/M
    expect(cost).toBe(0.01);
  });

  it("switches Haiku 5.5 to long-context prices above 100K prompt tokens", () => {
    const short = costUsd(
      counts({ inputTokens: 100_000, outputTokens: 1000 }),
      haiku,
      10,
    );
    const long = costUsd(
      counts({
        inputTokens: 60_000,
        cacheReadInputTokens: 40_001,
        outputTokens: 1000,
      }),
      haiku,
      10,
    );
    expect(short).toBe(0.0105); // 100,000 × $0.10/M + 1,000 × $0.50/M
    // 60,000 × $0.50/M + 40,001 × $0.05/M + 1,000 × $2.50/M, to 6 decimals
    expect(long).toBe(0.0345);
  });

  it("adds $10 per 1,000 web searches", () => {
    expect(costUsd(counts({ webSearches: 3 }), haiku, 10)).toBe(0.03);
  });

  it("halves token prices for batch requests, but not web searches", () => {
    const tokens = { inputTokens: 3000, outputTokens: 200, webSearches: 1 };
    // 3,000 × $0.10/M + 200 × $0.50/M = $0.0004, plus one search at $10/1,000
    expect(costUsd(counts(tokens), haiku, 10)).toBe(0.0104);
    expect(costUsd(counts({ ...tokens, batch: true }), haiku, 10)).toBe(0.0102);
  });
});
