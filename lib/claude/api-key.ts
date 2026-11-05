import "server-only";

import Anthropic, { AuthenticationError } from "@anthropic-ai/sdk";

import { readClaudeApiKey } from "@/lib/pipeline/engine-state";
import { ENGINE_NAMES, type OtherEngine } from "@/lib/schemas/settings";

import { BudgetExceededError } from "./budget";

// The Claude API key is optional: without one, steps run only on the engine
// Settings picks, such as Claude Code on the owner's plan, and on the OpenAI
// API when that's the key the app has. The key is the one pasted in setup or
// Settings, else ANTHROPIC_API_KEY (lib/pipeline/engine-state.ts).

/** How long checking a pasted key may take before the answer is "unknown". */
const KEY_CHECK_TIMEOUT_MS = 10_000;

/** Each client's copy with a pasted key, so calls don't make a new one each. */
const keyedClients = new WeakMap<
  Anthropic,
  { key: string; client: Anthropic }
>();

/** Whether the app has a Claude API key. */
export async function hasClaudeApiKey(): Promise<boolean> {
  return (await readClaudeApiKey()) !== null;
}

/**
 * A step would call the Claude API, and the app has no key for it. Handled
 * like a reached budget: the step stops with this message.
 */
export class NoApiKeyError extends BudgetExceededError {
  constructor(tried?: OtherEngine) {
    super(
      "no_key",
      tried
        ? `${ENGINE_NAMES[tried]} couldn't run this step, and there's no API key to run it on instead. Settings, under Agents run on, says why.`
        : "There's no Claude API key. Add one in Settings, under Agents run on, or pick Claude Code, Codex or the OpenAI API there.",
    );
    this.name = "NoApiKeyError";
  }
}

/**
 * `client` with the owner's Claude API key, for the call about to be made.
 * Throws NoApiKeyError when the app has no key; `tried` is the engine that
 * couldn't answer first. The key is read for every call, so a key pasted or
 * removed in Settings counts from the next call on.
 */
export async function withClaudeApiKey(
  client: Anthropic,
  tried?: OtherEngine,
): Promise<Anthropic> {
  const key = await readClaudeApiKey();
  if (!key) throw new NoApiKeyError(tried);
  if (key === client.apiKey) return client;
  const cached = keyedClients.get(client);
  if (cached?.key === key) return cached.client;
  const keyed = client.withOptions({ apiKey: key });
  keyedClients.set(client, { key, client: keyed });
  return keyed;
}

/**
 * Whether the Claude API accepts a key, from its free model list: "refused"
 * only when it says the key is wrong. Anything else, such as a network
 * failure, is "unknown", so the key is kept and the provider check says more.
 */
export async function checkClaudeApiKey(
  apiKey: string,
): Promise<"ok" | "refused" | "unknown"> {
  try {
    await new Anthropic({
      apiKey,
      maxRetries: 0,
      timeout: KEY_CHECK_TIMEOUT_MS,
    }).models.list({ limit: 1 });
    return "ok";
  } catch (error) {
    return error instanceof AuthenticationError ? "refused" : "unknown";
  }
}
