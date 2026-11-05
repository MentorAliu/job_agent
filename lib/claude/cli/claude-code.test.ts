import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BOX_DIR, fakeCliBox } from "@/test/fake-cli-box";

import {
  claudeCodeArgs,
  claudeCodeFailure,
  parseClaudeCodeOutput,
  runClaudeCode,
} from "./claude-code";
import type { CliTask } from "./task";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../test/fixtures/cli/${name}`, import.meta.url),
    "utf8",
  );

const task: CliTask = {
  stage: "discover",
  model: "claude-haiku-5-5",
  system: "Find open postings.",
  prompt: "Search for senior frontend roles.",
  schema: {
    type: "object",
    properties: { urls: { type: "array", items: { type: "string" } } },
    required: ["urls"],
    additionalProperties: false,
  },
  effort: "low",
  webSearches: 4,
};

describe("claudeCodeArgs", () => {
  it("allows only web search, with a turn for each search and the answer", () => {
    const args = claudeCodeArgs(task, BOX_DIR);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--model")).toBe("claude-haiku-5-5");
    expect(value("--effort")).toBe("low");
    expect(value("--tools")).toBe("WebSearch");
    expect(value("--allowedTools")).toBe("WebSearch");
    expect(value("--max-turns")).toBe("8");
    expect(value("--permission-mode")).toBe("dontAsk");
    expect(JSON.parse(value("--json-schema"))).toEqual(task.schema);
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--disable-slash-commands",
      ]),
    );
    // --bare would skip the plan's sign-in.
    expect(args).not.toContain("--bare");
  });

  it("turns every tool off for a step without web search", () => {
    const args = claudeCodeArgs({ ...task, webSearches: undefined }, BOX_DIR);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--allowedTools");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("4");
  });
});

describe("parseClaudeCodeOutput", () => {
  it("reads the answer, the run's tokens and its searches", () => {
    const reply = parseClaudeCodeOutput(
      fixture("claude-code-stream.jsonl"),
      "",
      task,
    );
    expect(reply.output).toEqual({
      urls: [
        "https://job-boards.greenhouse.io/northwindlabs/jobs/4000000001",
        "https://jobs.ashbyhq.com/contosohealth/2b6f7a10-0000-4000-8000-000000000001",
      ],
    });
    expect(reply.webSearches).toBe(2);
    expect(reply.model).toBe("claude-haiku-5-5");
    expect(reply.requestId).toBe("0d7c3f52-9a1e-4b6f-8c2d-5e4a1b7c9f30");
    // The whole run, not only the result's last turn.
    expect(reply.usage).toMatchObject({
      input_tokens: 28410,
      output_tokens: 3120,
      cache_read_input_tokens: 6548,
      cache_creation_input_tokens: 6064,
      server_tool_use: { web_search_requests: 2 },
    });
  });

  it("calls a refused token a sign-in failure", () => {
    expect(() =>
      parseClaudeCodeOutput(fixture("claude-code-login-failure.jsonl"), "", {
        ...task,
        webSearches: undefined,
      }),
    ).toThrow(
      expect.objectContaining({
        engine: "claude_code",
        failure: "login",
        message: expect.stringContaining("OAuth access token is invalid"),
      }),
    );
  });

  it("says why when the run stops with no result", () => {
    expect(() => parseClaudeCodeOutput("", "Killed", task)).toThrow(
      expect.objectContaining({
        failure: "failed",
        message: expect.stringContaining("Killed"),
      }),
    );
    const cutOff = fixture("claude-code-stream.jsonl")
      .split("\n")
      .filter((line) => !line.includes('"type":"result"'))
      .join("\n");
    expect(() => parseClaudeCodeOutput(cutOff, "", task)).toThrow(
      expect.objectContaining({ failure: "failed" }),
    );
  });
});

describe("claudeCodeFailure", () => {
  it.each([
    ["Claude AI usage limit reached|1793347200", "limit"],
    ["You're out of extra usage · resets 5pm", "limit"],
    ["Invalid API key · Please run /login", "login"],
    ["OAuth token has expired", "login"],
    ["Error: max turns reached", "failed"],
  ] as const)("%s is %s", (message, failure) => {
    const error = claudeCodeFailure(message);
    expect(error.failure).toBe(failure);
    expect(error.stopsTheRest).toBe(failure !== "failed");
  });
});

describe("runClaudeCode", () => {
  it("passes the prompt on stdin and the token in the environment", async () => {
    const { box, files, runs } = fakeCliBox(() => ({
      stdout: fixture("claude-code-stream.jsonl"),
    }));
    const reply = await runClaudeCode(box, task, "oauth-token");

    expect(files.get(`${BOX_DIR}/system.txt`)).toBe(task.system);
    expect(files.get(`${BOX_DIR}/prompt.txt`)).toBe(task.prompt);
    const [run] = runs;
    expect(run.cmd).toBe("bash");
    expect(run.args[1]).toBe(`exec claude "$@" < '${BOX_DIR}/prompt.txt'`);
    expect(run.args.slice(3)).toEqual(claudeCodeArgs(task, BOX_DIR));
    expect(run.env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-token" });
    expect(reply.webSearches).toBe(2);
  });
});
