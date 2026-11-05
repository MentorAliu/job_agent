import "server-only";

import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";

import type { EngineCheckResult } from "@/lib/pipeline/engine-check";
import {
  DEFAULT_PRICE_TABLE,
  ENGINE_NAMES,
  isCliEngine,
  openAiModel,
  type AgentEngine,
  type OtherEngine,
} from "@/lib/schemas/settings";

import { NoApiKeyError, withClaudeApiKey } from "./api-key";
import { assertWithinBudget, BudgetExceededError, estimateUsd } from "./budget";
import { getAnthropic } from "./client";
import { runCliTasks, type CliOutcome } from "./cli/run";
import { taskFromRequest } from "./cli/task";
import { getStageSetup, recordLlmCall, type StageSetup } from "./llm-call";
import { runOnOpenAi } from "./openai-api";
import { minimalThinking } from "./thinking";

// "Check it works": one tiny real call on the engine the owner picked, made
// the way the agents make theirs (structured output, the same sign-in or
// key, the same sandbox), with no fallback to another engine. Setup needs a
// passed check before it goes on; Settings shows the last one.

export const CHECK_ENGINE_SYSTEM_PROMPT =
  "You check that the app can reach the AI model it runs on. Answer only with the JSON the schema asks for.";

const CHECK_PROMPT = 'Reply with {"ok": true}.';

const checkAnswerSchema = z.object({ ok: z.boolean() });

const MAX_TOKENS = 64;

export function buildCheckRequest(
  model: string,
): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...minimalThinking(model),
    system: CHECK_ENGINE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: CHECK_PROMPT }],
    output_config: {
      effort: "low",
      format: zodOutputFormat(checkAnswerSchema),
    },
  };
}

/** What the owner is told when the Claude API refuses the check. */
export function claudeApiFailure(error: unknown): EngineCheckResult {
  if (error instanceof NoApiKeyError) {
    return {
      ok: false,
      failure: "setup",
      message: "There's no Claude API key yet. Paste one first.",
    };
  }
  if (error instanceof BudgetExceededError) {
    return { ok: false, failure: "budget", message: error.message };
  }
  if (error instanceof AuthenticationError) {
    return {
      ok: false,
      failure: "login",
      message:
        "The Claude API refused the key. Check it on platform.claude.com, under API keys, then paste it again.",
    };
  }
  if (error instanceof PermissionDeniedError) {
    return {
      ok: false,
      failure: "login",
      message: `The key can't use the Claude API: ${apiMessage(error)}`,
    };
  }
  if (error instanceof RateLimitError) {
    return {
      ok: false,
      failure: "limit",
      message:
        "The Claude API's rate limit was reached. Try again in a minute.",
    };
  }
  if (error instanceof NotFoundError) {
    return {
      ok: false,
      failure: "failed",
      message: `The Claude API couldn't find the model: ${apiMessage(error)}`,
    };
  }
  if (error instanceof APIConnectionError) {
    return {
      ok: false,
      failure: "busy",
      message:
        "The app couldn't reach the Claude API. Check its internet connection, then try again.",
    };
  }
  if (error instanceof APIError) {
    const message = apiMessage(error);
    if (/credit balance/i.test(message)) {
      return {
        ok: false,
        failure: "limit",
        message:
          "Your Anthropic account is out of credit. Add some on platform.claude.com, under Billing, then try again.",
      };
    }
    if (error.status !== undefined && error.status >= 500) {
      return {
        ok: false,
        failure: "busy",
        message:
          "The Claude API is busy or down right now. Try again in a few minutes.",
      };
    }
    return {
      ok: false,
      failure: "failed",
      message: `The Claude API refused the request: ${message}`,
    };
  }
  return {
    ok: false,
    failure: "failed",
    message: `The check couldn't run: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function apiMessage(error: APIError): string {
  const body = error.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? error.message;
}

/** Whether a reply's text is the check's answer. */
function answered(output: unknown): boolean {
  const parsed = checkAnswerSchema.safeParse(output);
  return parsed.success && parsed.data.ok;
}

async function checkClaudeApi(
  setup: StageSetup,
  client: Anthropic,
): Promise<EngineCheckResult> {
  const request = buildCheckRequest(setup.model);
  try {
    const api = await withClaudeApiKey(client);
    await assertWithinBudget(
      estimateUsd(setup, { inputTokens: 300, outputTokens: MAX_TOKENS }),
    );
    const { data: message, request_id } = await api.messages
      .create(request)
      .withResponse();
    await recordLlmCall(setup, message.usage, request_id ?? null);
    const text = message.content.find((block) => block.type === "text")?.text;
    let output: unknown = null;
    try {
      output = text ? JSON.parse(text) : null;
    } catch {
      output = null;
    }
    if (!answered(output)) {
      return {
        ok: false,
        failure: "failed",
        message:
          "The Claude API answered, but not in the form the agents need. Try again; if it keeps happening, pick another model for checks in Settings.",
      };
    }
    return { ok: true, model: message.model };
  } catch (error) {
    return claudeApiFailure(error);
  }
}

/** The setup for a check on `engine`, with its OpenAI stand-in when needed. */
function setupOn(base: StageSetup, engine: OtherEngine): StageSetup {
  const setup: StageSetup = { ...base, engine };
  if (engine === "openai_api" && !setup.openAi) {
    const model = openAiModel(base.model);
    const price = DEFAULT_PRICE_TABLE.models[model];
    if (price) setup.openAi = { model, price };
  }
  return setup;
}

async function checkOtherEngine(
  base: StageSetup,
  engine: OtherEngine,
): Promise<EngineCheckResult> {
  const setup = setupOn(base, engine);
  const task = taskFromRequest(buildCheckRequest(setup.model), "check_engine");
  if (!task) throw new Error("The check's request can't run as a task.");
  const [outcome]: CliOutcome[] = isCliEngine(engine)
    ? await runCliTasks(engine, [task])
    : await runOnOpenAi(setup, [task]);
  if (!outcome) {
    return {
      ok: false,
      failure: "failed",
      message: `${ENGINE_NAMES[engine]} gave no answer.`,
    };
  }
  if (!outcome.ok) {
    return {
      ok: false,
      failure: outcome.error.failure,
      message: outcome.error.message,
    };
  }
  const { reply } = outcome;
  const answerSetup: StageSetup =
    engine === "openai_api" && setup.openAi
      ? { ...setup, model: reply.model, price: setup.openAi.price }
      : { ...setup, model: reply.model };
  await recordLlmCall(answerSetup, reply.usage, reply.requestId, { engine });
  if (!answered(reply.output)) {
    return {
      ok: false,
      failure: "failed",
      message: `${ENGINE_NAMES[engine]} answered, but not in the form the agents need. Try again.`,
    };
  }
  return { ok: true, model: reply.model };
}

/**
 * Runs one check on `engine`. It never falls back to another engine: the
 * point is to know this one works. Every answer is logged to `llm_call`.
 */
export async function checkEngine(
  engine: AgentEngine,
  client: Anthropic = getAnthropic(),
): Promise<EngineCheckResult> {
  const setup = await getStageSetup("check_engine");
  return engine === "claude_api"
    ? checkClaudeApi(setup, client)
    : checkOtherEngine(setup, engine);
}
