import "server-only";

import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

// Models whose `thinking: { type: "disabled" }` is accepted at effort `high`
// or below.
const DISABLE_ACCEPTED = new Set([
  "claude-haiku-5-5",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
]);

/**
 * The cheapest thinking setting a model accepts, for calls that copy or sort
 * text rather than reason about it. Pair it with effort `high` or below.
 * - Sonnet 5.5 rejects `disabled`; `between_tools` turns thinking off there,
 *   and only there.
 * - Opus 5.5 and the Fable models can't turn thinking off, so the setting is
 *   left out and low effort keeps it short. Unknown models get the same,
 *   since every current model accepts that.
 */
export function minimalThinking(
  model: string,
): Pick<MessageCreateParamsNonStreaming, "thinking"> {
  if (model === "claude-sonnet-5-5") {
    return { thinking: { type: "between_tools" } };
  }
  if (DISABLE_ACCEPTED.has(model)) return { thinking: { type: "disabled" } };
  return {};
}
