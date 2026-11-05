import "server-only";

import type {
  MessageCreateParamsNonStreaming,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";

import type { LlmStage, OtherEngine } from "@/lib/schemas/settings";

// One agent step as a command-line agent or the OpenAI API runs it:
// instructions, the prompt, and the JSON Schema its answer must match.

/**
 * Why a step couldn't run on the engine Settings picked. The step then runs
 * on an API instead, when the app has a key for one (lib/claude/send.ts).
 * - `setup`: the engine isn't signed in.
 * - `limit`: the plan's usage limit is reached, or the OpenAI account's.
 * - `login`: the sign-in or API key was refused or has expired.
 * - `busy`: another step was using the sign-in for too long.
 * - `sandbox`: the sandbox or folder the agent runs in failed, or the agent
 *   couldn't start.
 * - `budget`: a paid call would go past the budget, so it wasn't made.
 * - `failed`: the engine ran but gave no usable answer.
 */
export type CliFailure =
  "setup" | "limit" | "login" | "busy" | "sandbox" | "budget" | "failed";

/**
 * A path as one word for `bash -c`, whatever it holds: spaces, or the
 * backslashes of a Windows temporary folder such as C:\Users\A B\AppData.
 */
export function shellWord(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

export class CliEngineError extends Error {
  constructor(
    readonly engine: OtherEngine,
    readonly failure: CliFailure,
    message: string,
  ) {
    super(message);
    this.name = "CliEngineError";
  }

  /** Later steps in the same box would fail the same way. */
  get stopsTheRest(): boolean {
    return this.failure !== "failed";
  }
}

export type CliTask = {
  stage: LlmStage;
  /**
   * The Claude model, for Claude Code. Codex uses the plan's own model, and
   * the OpenAI API the model that stands in for this one.
   */
  model: string;
  system: string;
  prompt: string;
  /** The JSON Schema the answer must match. */
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  /** Turns web search on, for at most this many searches. Off when unset. */
  webSearches?: number;
  /**
   * The only sites web search may return, for an engine that can filter its
   * searches (the OpenAI API). The prompt says so too, for the others.
   */
  allowedDomains?: string[];
};

export type CliReply = {
  /** The answer, matching the task's schema. Not validated yet. */
  output: unknown;
  usage: Usage;
  /** The model that answered, as the agent reports it. */
  model: string;
  /** The agent's session or thread id, logged as the request id. */
  requestId: string | null;
  webSearches: number;
};

/** A Usage with every field the logging reads, from token counts. */
export function usageFrom(counts: {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  webSearches?: number;
}): Usage {
  return {
    input_tokens: counts.inputTokens,
    output_tokens: counts.outputTokens,
    cache_read_input_tokens: counts.cacheReadInputTokens ?? 0,
    cache_creation_input_tokens: counts.cacheCreationInputTokens ?? 0,
    cache_creation: null,
    server_tool_use: {
      web_search_requests: counts.webSearches ?? 0,
      web_fetch_requests: 0,
    },
    inference_geo: null,
    output_tokens_details: null,
    service_tier: null,
    speed: null,
  };
}

/** The text of a system prompt, whether it's a string or text blocks. */
function systemText(system: MessageCreateParamsNonStreaming["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((block) => block.text).join("\n\n");
}

/**
 * A Messages request as a command-line task: the same instructions, prompt,
 * schema and effort. Returns null for a request a command-line agent can't
 * take as it is, such as one with a PDF from the Files API or tools.
 */
export function taskFromRequest(
  request: MessageCreateParamsNonStreaming,
  stage: LlmStage,
): CliTask | null {
  const format = request.output_config?.format;
  if (!format || format.type !== "json_schema") return null;
  if (request.tools?.length) return null;
  if (request.messages.length !== 1) return null;
  const [message] = request.messages;
  if (message.role !== "user") return null;

  const parts: string[] = [];
  if (typeof message.content === "string") {
    parts.push(message.content);
  } else {
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push(block.text);
      } else if (block.type === "document" && block.source.type === "text") {
        const title = block.title ? ` title="${block.title}"` : "";
        parts.push(`<document${title}>\n${block.source.data}\n</document>`);
      } else {
        return null;
      }
    }
  }
  const effort = request.output_config?.effort;
  return {
    stage,
    model: request.model,
    system: systemText(request.system),
    prompt: parts.join("\n\n"),
    schema: format.schema,
    effort: effort === "medium" || effort === "high" ? effort : "low",
  };
}
