import "server-only";

import type { Usage } from "@anthropic-ai/sdk/resources/messages";

import type { ModelPrice } from "@/lib/schemas/settings";

/** The token counts of one Messages API response, as stored in `llm_call`. */
export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  /** The part of `cacheCreationInputTokens` written to the 1-hour cache. */
  cacheCreation1hInputTokens: number;
  cacheReadInputTokens: number;
  webSearches: number;
  /** Sent through the Message Batches API, which halves token prices. */
  batch: boolean;
};

export function tokenCounts(usage: Usage): TokenCounts {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheCreation1hInputTokens:
      usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    batch: usage.service_tier === "batch",
  };
}

/**
 * The cost in USD of one request. A prompt over the model's long-context
 * threshold (cache reads and writes included) pays the higher prices, and a
 * batch request pays half the token prices.
 */
export function costUsd(
  counts: TokenCounts,
  price: ModelPrice,
  webSearchPer1k: number,
): number {
  const promptTokens =
    counts.inputTokens +
    counts.cacheCreationInputTokens +
    counts.cacheReadInputTokens;
  const rates =
    price.longContext && promptTokens > price.longContext.aboveTokens
      ? price.longContext
      : price;
  const cacheWrite5m =
    counts.cacheCreationInputTokens - counts.cacheCreation1hInputTokens;

  const tokensUsd =
    (counts.inputTokens * rates.input +
      counts.outputTokens * rates.output +
      cacheWrite5m * rates.cacheWrite5m +
      counts.cacheCreation1hInputTokens * rates.cacheWrite1h +
      counts.cacheReadInputTokens * rates.cacheRead) /
    1_000_000 /
    (counts.batch ? 2 : 1);
  const searchesUsd = (counts.webSearches * webSearchPer1k) / 1000;
  // The column keeps 6 decimal places.
  return Math.round((tokensUsd + searchesUsd) * 1e6) / 1e6;
}
