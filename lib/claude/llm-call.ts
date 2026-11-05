import "server-only";

import type { Usage } from "@anthropic-ai/sdk/resources/messages";

import type { llmCall } from "@/db/schema";
import { insertLlmCall } from "@/lib/pipeline/llm-call";
import { readSettings } from "@/lib/pipeline/settings";
import {
  DEFAULT_PRICE_TABLE,
  isCliEngine,
  isOtherEngine,
  openAiModel,
  type LlmStage,
  type ModelPrice,
  type OtherEngine,
} from "@/lib/schemas/settings";

import { costUsd, tokenCounts } from "./cost";

/** Which model a stage uses, and the prices to log its calls with. */
export type StageSetup = {
  stage: LlmStage;
  model: string;
  price: ModelPrice;
  webSearchPer1k: number;
  /**
   * The engine the stage tries first, before the Claude API: a command-line
   * agent on the owner's plan, or the OpenAI API. Unset: the Claude API
   * only. Logging never reads it: a response counts as free only when its
   * links say a command-line agent made it.
   */
  engine?: OtherEngine;
  /**
   * The OpenAI model that stands in for `model`, and its prices, for a step
   * on the OpenAI API: picked in Settings, or when a plan's command-line
   * agent can't answer and only an OpenAI key is there to fall back on.
   */
  openAi?: { model: string; price: ModelPrice };
};

/**
 * Reads the stage's model and prices from Settings, falling back to the
 * defaults. Pass `model` to use another model with the same prices table.
 * Throws before any request is made when the model has no price, so no call
 * goes unlogged or uncosted.
 */
export async function getStageSetup(
  stage: LlmStage,
  model?: string,
): Promise<StageSetup> {
  const { models, prices, agentEngine } = await readSettings();
  model ??= models[stage];

  const price = prices.models[model];
  if (!price) {
    throw new Error(
      `No price for ${model} in the price table, so its cost can't be logged. Pick another model in Settings.`,
    );
  }
  const setup: StageSetup = {
    stage,
    model,
    price,
    webSearchPer1k: prices.webSearchPer1k,
  };
  if (isOtherEngine(agentEngine)) setup.engine = agentEngine;
  if (agentEngine !== "claude_api") {
    const stand = openAiModel(model);
    // A price table saved before OpenAI's models were added has none for them.
    const standPrice =
      prices.models[stand] ?? DEFAULT_PRICE_TABLE.models[stand];
    if (standPrice) setup.openAi = { model: stand, price: standPrice };
  }
  return setup;
}

export type LlmCallLinks = {
  runId?: string;
  jobId?: string;
  /** A Message Batches result, priced at half the token rates. */
  batch?: boolean;
  /**
   * Made by another engine than the Claude API. A command-line agent's
   * answer is on the owner's plan, so it costs nothing.
   */
  engine?: OtherEngine;
};

/**
 * The `llm_call` row for one response, with its cost in USD from the setup's
 * prices. A response from a command-line agent on the owner's plan costs
 * nothing against the budget.
 */
export function llmCallRow(
  setup: StageSetup,
  usage: Usage,
  requestId: string | null,
  links: LlmCallLinks = {},
): typeof llmCall.$inferInsert & { costUsd: number } {
  const counts = tokenCounts(usage);
  if (links.batch) counts.batch = true;
  return {
    runId: links.runId,
    jobId: links.jobId,
    stage: setup.stage,
    engine: links.engine ?? "claude_api",
    model: setup.model,
    inputTokens: counts.inputTokens,
    outputTokens: counts.outputTokens,
    cacheCreationInputTokens: counts.cacheCreationInputTokens,
    cacheReadInputTokens: counts.cacheReadInputTokens,
    webSearches: counts.webSearches,
    costUsd:
      links.engine && isCliEngine(links.engine)
        ? 0
        : costUsd(counts, setup.price, setup.webSearchPer1k),
    requestId,
  };
}

/** Writes one row to `llm_call` and returns its cost in USD. */
export async function recordLlmCall(
  setup: StageSetup,
  usage: Usage,
  requestId: string | null,
  links: LlmCallLinks = {},
): Promise<number> {
  const row = llmCallRow(setup, usage, requestId, links);
  await insertLlmCall(row);
  return row.costUsd;
}
