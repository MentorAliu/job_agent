import "server-only";

import { z } from "zod";

import { readOpenAiKey } from "@/lib/pipeline/engine-state";
import type { ModelPrice } from "@/lib/schemas/settings";

import { assertWithinBudget, BudgetExceededError, estimateUsd } from "./budget";
import { noteOutcomes, type CliOutcome } from "./cli/run";
import {
  CliEngineError,
  usageFrom,
  type CliFailure,
  type CliReply,
  type CliTask,
} from "./cli/task";
import type { StageSetup } from "./llm-call";

// Agent steps on OpenAI's Responses API, with the owner's API key. Each step
// gets the same instructions, prompt and JSON Schema a command-line agent
// gets, and the OpenAI model that stands in for its Claude model answers.
// The calls are paid from the owner's OpenAI credit, so they're priced and
// count toward the monthly budget like Claude API calls.

const API_URL = "https://api.openai.com/v1";
/** Inside the Inngest step's 300 s, with time left to fall back to Claude. */
const CALL_TIMEOUT_MS = 180_000;
const KEY_CHECK_TIMEOUT_MS = 10_000;
/** A cap on each answer, reasoning included, so one call can't run away. */
const MAX_OUTPUT_TOKENS = 32_000;
/** What the budget check assumes an answer takes, reasoning included. */
const OUTPUT_ESTIMATE_TOKENS = 8_000;

/** A Responses API request for one task, answered in the task's schema. */
export function openAiRequest(task: CliTask, model: string) {
  return {
    model,
    instructions: task.system,
    input: task.prompt,
    text: {
      format: {
        type: "json_schema",
        name: task.stage,
        schema: task.schema,
        strict: true,
      },
    },
    reasoning: { effort: task.effort },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    // Not kept on OpenAI's side for 30 days: prompts hold the CV.
    store: false,
    ...(task.webSearches
      ? {
          tools: [
            {
              type: "web_search",
              ...(task.allowedDomains?.length
                ? { filters: { allowed_domains: task.allowedDomains } }
                : {}),
            },
          ],
          max_tool_calls: task.webSearches,
        }
      : {}),
  };
}

const contentSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  refusal: z.string().optional(),
});

/** The parts of a Responses API response the steps read. */
const responseSchema = z.looseObject({
  id: z.string(),
  status: z.string().nullish(),
  error: z.looseObject({ message: z.string() }).nullish(),
  incomplete_details: z.looseObject({ reason: z.string().nullish() }).nullish(),
  output: z.array(
    z.looseObject({
      type: z.string(),
      content: z.array(contentSchema).nullish(),
      action: z.looseObject({ type: z.string() }).nullish(),
    }),
  ),
  usage: z
    .looseObject({
      input_tokens: z.number(),
      input_tokens_details: z
        .looseObject({
          cached_tokens: z.number().nullish(),
          cache_write_tokens: z.number().nullish(),
        })
        .nullish(),
      output_tokens: z.number(),
    })
    .nullish(),
  tool_usage: z
    .looseObject({
      web_search: z.looseObject({ num_requests: z.number() }).nullish(),
    })
    .nullish(),
});

const errorBodySchema = z.looseObject({
  error: z.looseObject({
    message: z.string().nullish(),
    code: z.string().nullish(),
    type: z.string().nullish(),
  }),
});

function failure(kind: CliFailure, message: string): CliEngineError {
  return new CliEngineError("openai_api", kind, message);
}

/** What an HTTP error from OpenAI means for the step, in the owner's words. */
export function openAiFailure(status: number, body: unknown): CliEngineError {
  const parsed = errorBodySchema.safeParse(body);
  const error = parsed.success ? parsed.data.error : null;
  const message = (error?.message?.trim() || `HTTP ${status}`).slice(0, 200);
  if (status === 401) {
    return failure(
      "login",
      `OpenAI refused the API key (${message}). Paste a new key in Settings.`,
    );
  }
  if (status === 429) {
    return error?.code === "insufficient_quota" ||
      error?.type === "insufficient_quota"
      ? failure(
          "limit",
          `Your OpenAI account is out of credit or at its spend limit (${message}).`,
        )
      : failure("limit", `OpenAI's rate limit is reached (${message}).`);
  }
  return failure(
    "failed",
    `OpenAI couldn't answer (HTTP ${status}: ${message}).`,
  );
}

/** The answer, its usage and how many searches it took. */
export function parseOpenAiResponse(body: unknown, model: string): CliReply {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw failure("failed", "OpenAI's reply wasn't a response.");
  }
  const response = parsed.data;
  if (response.status === "failed" || response.error) {
    throw failure(
      "failed",
      `OpenAI couldn't answer (${response.error?.message ?? "failed"}).`,
    );
  }
  if (response.status === "incomplete") {
    throw failure(
      "failed",
      `OpenAI's answer was cut off (${response.incomplete_details?.reason ?? "incomplete"}).`,
    );
  }

  const parts = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  const refusal = parts.find((part) => part.type === "refusal");
  if (refusal) {
    throw failure(
      "failed",
      `OpenAI declined the step (${refusal.refusal ?? "refused"}).`,
    );
  }
  const text = parts
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw failure("failed", "OpenAI's answer wasn't JSON.");
  }

  const webSearches =
    response.tool_usage?.web_search?.num_requests ??
    response.output.filter(
      (item) =>
        item.type === "web_search_call" && item.action?.type === "search",
    ).length;
  const usage = response.usage;
  // input_tokens counts the cached and newly cached tokens too.
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    output,
    usage: usageFrom({
      inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached - written),
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadInputTokens: cached,
      cacheCreationInputTokens: written,
      webSearches,
    }),
    model,
    requestId: response.id,
    webSearches,
  };
}

async function callOpenAi(
  task: CliTask,
  model: string,
  apiKey: string,
): Promise<CliReply> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openAiRequest(task, model)),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw failure("failed", `Couldn't reach OpenAI (${message}).`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw openAiFailure(response.status, body);
  return parseOpenAiResponse(body, model);
}

/** An upper estimate of one task's cost, at the stand-in model's prices. */
function taskEstimateUsd(
  setup: StageSetup,
  price: ModelPrice,
  task: CliTask,
): number {
  return estimateUsd(
    { ...setup, price },
    {
      // About 3 characters a token, so the estimate errs high.
      inputTokens: Math.ceil((task.system.length + task.prompt.length) / 3),
      outputTokens: OUTPUT_ESTIMATE_TOKENS,
      webSearches: task.webSearches ?? 0,
    },
  );
}

/**
 * Runs tasks on the OpenAI API one after another, each after a budget
 * check. A task that fails leaves the others to run, unless its failure
 * would stop them too, such as a refused key. Records how the engine did,
 * for Settings.
 */
export async function runOnOpenAi(
  setup: StageSetup,
  tasks: CliTask[],
  runId?: string,
): Promise<CliOutcome[]> {
  if (tasks.length === 0) return [];
  const { openAi } = setup;
  const apiKey = openAi ? await readOpenAiKey() : null;
  if (!openAi || !apiKey) {
    const error = failure(
      "setup",
      openAi
        ? "The OpenAI API isn't set up: paste an API key in Settings."
        : `The OpenAI API has no price for the model that stands in for ${setup.model}.`,
    );
    const outcomes = tasks.map((): CliOutcome => ({ ok: false, error }));
    await noteOutcomes("openai_api", outcomes);
    return outcomes;
  }

  const outcomes: CliOutcome[] = [];
  for (const task of tasks) {
    const stopped = outcomes.findLast((outcome) => !outcome.ok);
    if (stopped && !stopped.ok && stopped.error.stopsTheRest) {
      outcomes.push(stopped);
      continue;
    }
    try {
      await assertWithinBudget(
        taskEstimateUsd(setup, openAi.price, task),
        runId,
      );
      const reply = await callOpenAi(task, openAi.model, apiKey);
      outcomes.push({ ok: true, reply });
    } catch (error) {
      outcomes.push({
        ok: false,
        error:
          error instanceof CliEngineError
            ? error
            : error instanceof BudgetExceededError
              ? failure("budget", error.message)
              : failure(
                  "failed",
                  `OpenAI couldn't answer (${error instanceof Error ? error.message : String(error)}).`,
                ),
      });
    }
  }
  await noteOutcomes("openai_api", outcomes);
  return outcomes;
}

/**
 * Whether OpenAI accepts an API key, from its free model list: "refused"
 * only when OpenAI says the key is wrong. A key that may only call the
 * Responses API can't list models, so anything else is "unknown".
 */
export async function checkOpenAiKey(
  apiKey: string,
): Promise<"ok" | "refused" | "unknown"> {
  try {
    const response = await fetch(`${API_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    });
    if (response.ok) return "ok";
    return response.status === 401 ? "refused" : "unknown";
  } catch {
    return "unknown";
  }
}
