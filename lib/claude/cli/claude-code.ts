import "server-only";

import type { Usage } from "@anthropic-ai/sdk/resources/messages";

import type { CliBox } from "./box";
import {
  CliEngineError,
  shellWord,
  usageFrom,
  type CliReply,
  type CliTask,
} from "./task";

// One step on Claude Code, in print mode, signed in with the owner's own
// Claude plan through CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
// It runs the published CLI as it is, not the Agent SDK: Anthropic's terms
// let the owner sign in to the unmodified Claude Code with their own plan.

/** An agent that hangs is stopped well before its box is. */
const RUN_TIMEOUT_MS = 210_000;

/** Where the step's files go in the box's folder. */
function paths(dir: string) {
  return { system: `${dir}/system.txt`, prompt: `${dir}/prompt.txt` };
}

/**
 * The command line: the app's own system prompt in place of Claude Code's,
 * no tools but web search when the step needs it, no MCP servers, skills or
 * saved session, and the answer as JSON matching the step's schema. Each web
 * search and the final answer take a turn each.
 */
export function claudeCodeArgs(task: CliTask, dir: string): string[] {
  const tools = task.webSearches ? "WebSearch" : "";
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    task.model,
    "--effort",
    task.effort,
    "--system-prompt-file",
    paths(dir).system,
    "--json-schema",
    JSON.stringify(task.schema),
    "--tools",
    tools,
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--max-turns",
    String((task.webSearches ?? 0) + 4),
  ];
  if (tools) args.push("--allowedTools", tools);
  return args;
}

type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

type StreamLine = {
  type?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  usage?: Partial<Usage>;
  modelUsage?: Record<string, ModelUsage>;
  terminal_reason?: string;
  message?: { content?: { type?: string; name?: string }[] };
};

function lines(stdout: string): StreamLine[] {
  const parsed: StreamLine[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      parsed.push(JSON.parse(line) as StreamLine);
    } catch {
      // A line cut off by the timeout.
    }
  }
  return parsed;
}

/** What went wrong, in the owner's words, from Claude Code's own message. */
export function claudeCodeFailure(message: string): CliEngineError {
  const text = message.trim().slice(0, 200) || "no answer";
  if (
    /usage limit|limit reached|out of (extra )?usage|rate.?limit/i.test(text)
  ) {
    return new CliEngineError(
      "claude_code",
      "limit",
      `Your Claude plan's usage limit is reached (${text}).`,
    );
  }
  if (
    /not logged in|\/login|oauth|401|403|authenticat|unauthori|token.*(expired|revoked|invalid)/i.test(
      text,
    )
  ) {
    return new CliEngineError(
      "claude_code",
      "login",
      `Claude Code's sign-in was refused (${text}). Run claude setup-token again and update CLAUDE_CODE_OAUTH_TOKEN.`,
    );
  }
  return new CliEngineError(
    "claude_code",
    "failed",
    `Claude Code gave no answer (${text}).`,
  );
}

/** The answer, its usage and how many searches it took, from the JSON stream. */
export function parseClaudeCodeOutput(
  stdout: string,
  stderr: string,
  task: CliTask,
): CliReply {
  const events = lines(stdout);
  const result = events.findLast((event) => event.type === "result");
  if (!result) {
    throw claudeCodeFailure(stderr || stdout || "the agent stopped early");
  }
  if (result.is_error || result.structured_output === undefined) {
    throw claudeCodeFailure(
      result.result || result.terminal_reason || "no structured answer",
    );
  }
  let webSearches = 0;
  for (const event of events) {
    if (event.type !== "assistant") continue;
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "WebSearch") {
        webSearches++;
      }
    }
  }
  const models = Object.entries(result.modelUsage ?? {});
  return {
    output: result.structured_output,
    usage: usageFrom({ ...runTokens(result), webSearches }),
    model:
      models.find(([model]) => model === task.model)?.[0] ??
      models[0]?.[0] ??
      task.model,
    requestId: result.session_id ?? null,
    webSearches,
  };
}

/**
 * The tokens of the whole run. The result's `usage` covers only its last
 * turn, so the per-model totals are summed when the agent reports them.
 */
function runTokens(result: StreamLine) {
  const models = Object.values(result.modelUsage ?? {});
  if (models.length > 0) {
    const sum = (key: keyof ModelUsage) =>
      models.reduce((total, model) => total + (model[key] ?? 0), 0);
    return {
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cacheReadInputTokens: sum("cacheReadInputTokens"),
      cacheCreationInputTokens: sum("cacheCreationInputTokens"),
    };
  }
  const usage = result.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Runs one task on Claude Code in the box. */
export async function runClaudeCode(
  box: CliBox,
  task: CliTask,
  token: string,
): Promise<CliReply> {
  const files = paths(box.dir);
  await box.writeFiles([
    { path: files.system, content: task.system },
    { path: files.prompt, content: task.prompt },
  ]);
  // The prompt comes in on stdin, since it can be longer than one argument.
  const { stdout, stderr } = await box.run(
    "bash",
    [
      "-c",
      `exec claude "$@" < ${shellWord(files.prompt)}`,
      "claude",
      ...claudeCodeArgs(task, box.dir),
    ],
    {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: token,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
      },
      timeoutMs: RUN_TIMEOUT_MS,
    },
  );
  return parseClaudeCodeOutput(stdout, stderr, task);
}
