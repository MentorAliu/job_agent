import "server-only";

import type { CliBox } from "./box";
import {
  CliEngineError,
  shellWord,
  usageFrom,
  type CliReply,
  type CliTask,
} from "./task";

// One step on Codex, with `codex exec`, signed in with the owner's ChatGPT
// plan through the auth.json `codex login` writes. Codex renews the tokens in
// that file as it runs, so the caller keeps the file Codex leaves behind
// rather than the one it put in (OpenAI's advice for short-lived runners).

const RUN_TIMEOUT_MS = 210_000;

/** Where the step's files, and Codex's own, go in the box's folder. */
function paths(dir: string) {
  const home = `${dir}/codex`;
  return {
    home,
    auth: `${home}/auth.json`,
    prompt: `${dir}/prompt.txt`,
    schema: `${dir}/schema.json`,
    answer: `${dir}/answer.json`,
  };
}

/**
 * Codex has no flag for a system prompt, so the step's instructions open the
 * prompt, with a note that no command is needed.
 */
export function codexPrompt(task: CliTask): string {
  return [
    "# Instructions",
    task.system,
    "Everything you need is in this message. Don't run commands or read files.",
    "# Task",
    task.prompt,
  ].join("\n\n");
}

/**
 * The tools that run commands or open files. With them off, a posting can't
 * get Codex to read its own auth.json into an answer.
 */
const FILE_TOOLS = ["shell_tool", "unified_exec", "view_image"];

/**
 * `codex exec` without the owner's config, rules or saved sessions, and
 * without tools that reach the files in its box.
 */
export function codexArgs(task: CliTask, dir: string): string[] {
  const files = paths(dir);
  return [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    ...FILE_TOOLS.flatMap((tool) => ["--disable", tool]),
    "--json",
    "--output-schema",
    files.schema,
    "--output-last-message",
    files.answer,
    "-c",
    `web_search="${task.webSearches ? "live" : "disabled"}"`,
    "-c",
    `model_reasoning_effort="${task.effort}"`,
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    'approval_policy="never"',
    "-",
  ];
}

type CodexEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  item?: { type?: string; message?: string };
};

function events(stdout: string): CodexEvent[] {
  const parsed: CodexEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      parsed.push(JSON.parse(line) as CodexEvent);
    } catch {
      // A line cut off by the timeout.
    }
  }
  return parsed;
}

/** What went wrong, in the owner's words, from Codex's own message. */
export function codexFailure(message: string): CliEngineError {
  const text = message.trim().slice(0, 200) || "no answer";
  if (/usage limit|rate.?limit|429|quota|too many requests/i.test(text)) {
    return new CliEngineError(
      "codex",
      "limit",
      `Your ChatGPT plan's Codex limit is reached (${text}).`,
    );
  }
  if (
    /401|403|unauthori|refresh.?token|sign.?in|log.?in|expired|authenticat/i.test(
      text,
    )
  ) {
    return new CliEngineError(
      "codex",
      "login",
      `Codex's sign-in was refused (${text}). Run codex login again and paste the new auth.json in Settings.`,
    );
  }
  return new CliEngineError(
    "codex",
    "failed",
    `Codex gave no answer (${text}).`,
  );
}

/** The answer, its usage and how many searches it took. */
export function parseCodexRun(
  stdout: string,
  stderr: string,
  answer: string | null,
): CliReply {
  const stream = events(stdout);
  const failed = stream.findLast((event) => event.type === "turn.failed");
  const failure = failed ?? stream.findLast((event) => event.type === "error");
  let output: unknown;
  try {
    output = answer?.trim() && !failed ? JSON.parse(answer) : undefined;
  } catch {
    output = undefined;
  }
  if (output === undefined) {
    throw codexFailure(
      failure?.error?.message ??
        failure?.message ??
        (stderr.trim().split("\n").at(-1) || "no structured answer"),
    );
  }

  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let webSearches = 0;
  for (const event of stream) {
    if (event.type === "turn.completed" && event.usage) {
      inputTokens += event.usage.input_tokens ?? 0;
      cachedTokens += event.usage.cached_input_tokens ?? 0;
      outputTokens += event.usage.output_tokens ?? 0;
    }
    if (event.type === "item.completed" && event.item?.type === "web_search") {
      webSearches++;
    }
  }
  return {
    output,
    usage: usageFrom({
      inputTokens: Math.max(0, inputTokens - cachedTokens),
      outputTokens,
      cacheReadInputTokens: cachedTokens,
      webSearches,
    }),
    model: "codex",
    requestId:
      stream.find((event) => event.type === "thread.started")?.thread_id ??
      null,
    webSearches,
  };
}

/**
 * Runs one task on Codex in the box. When Codex renewed the tokens in
 * auth.json, `keepLogin` gets the new file, even when the step then fails.
 */
export async function runCodex(
  box: CliBox,
  task: CliTask,
  authJson: string,
  keepLogin: (renewed: string) => Promise<void>,
): Promise<CliReply> {
  const files = paths(box.dir);
  await box.writeFiles([
    { path: files.auth, content: authJson, mode: 0o600 },
    { path: files.prompt, content: codexPrompt(task) },
    { path: files.schema, content: JSON.stringify(task.schema) },
    // An earlier task's answer, in the same box, is never read as this one's.
    { path: files.answer, content: "" },
  ]);
  const { stdout, stderr } = await box.run(
    "bash",
    [
      "-c",
      `exec codex "$@" < ${shellWord(files.prompt)}`,
      "codex",
      ...codexArgs(task, box.dir),
    ],
    { env: { CODEX_HOME: files.home }, timeoutMs: RUN_TIMEOUT_MS },
  );
  const [answer, renewed] = await Promise.all([
    box.readFile(files.answer),
    box.readFile(files.auth),
  ]);
  if (renewed?.trim() && renewed !== authJson) await keepLogin(renewed);
  return parseCodexRun(stdout, stderr, answer);
}
