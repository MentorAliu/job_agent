import "server-only";

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/**
 * The Claude API client. It starts with ANTHROPIC_API_KEY, if there is one;
 * each call gets the owner's key from withClaudeApiKey (./api-key.ts), which
 * prefers a key pasted in setup or Settings. So `next build` works without a
 * key, and a pasted key needs no restart.
 */
export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 3 });
  return client;
}
