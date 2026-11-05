import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { BOX_DIR, fakeCliBox } from "@/test/fake-cli-box";

import {
  codexArgs,
  codexFailure,
  codexPrompt,
  parseCodexRun,
  runCodex,
} from "./codex";
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
  effort: "medium",
  webSearches: 4,
};

const ANSWER = JSON.stringify({
  urls: ["https://job-boards.greenhouse.io/northwindlabs/jobs/4000000001"],
});
const AUTH = JSON.stringify({ auth_mode: "chatgpt", tokens: { id: "old" } });

describe("codexArgs", () => {
  it("runs without the owner's config, read-only, with the answer in a file", () => {
    const args = codexArgs(task, BOX_DIR);
    expect(args.slice(0, 1)).toEqual(["exec"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        'web_search="live"',
        'model_reasoning_effort="medium"',
        'cli_auth_credentials_store="file"',
        'approval_policy="never"',
      ]),
    );
    // No tool that runs a command or opens a file, so nothing can read auth.json.
    for (const tool of ["shell_tool", "unified_exec", "view_image"]) {
      expect(args[args.indexOf(tool) - 1]).toBe("--disable");
    }
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args[args.indexOf("--output-schema") + 1]).toBe(
      `${BOX_DIR}/schema.json`,
    );
    // The prompt comes from stdin.
    expect(args.at(-1)).toBe("-");
  });

  it("turns web search off for a step without it", () => {
    expect(codexArgs({ ...task, webSearches: undefined }, BOX_DIR)).toContain(
      'web_search="disabled"',
    );
  });

  it("opens the prompt with the step's instructions", () => {
    const prompt = codexPrompt(task);
    expect(prompt.indexOf(task.system)).toBeLessThan(
      prompt.indexOf(task.prompt),
    );
  });
});

describe("parseCodexRun", () => {
  it("reads the answer file, the tokens and the searches", () => {
    const reply = parseCodexRun(fixture("codex-stream.jsonl"), "", ANSWER);
    expect(reply.output).toEqual(JSON.parse(ANSWER));
    expect(reply.webSearches).toBe(2);
    expect(reply.requestId).toBe("01a18799-0000-7000-8000-000000000002");
    // Cached tokens are counted once, as cache reads.
    expect(reply.usage).toMatchObject({
      input_tokens: 24250 - 11008,
      cache_read_input_tokens: 11008,
      output_tokens: 912,
    });
  });

  it("calls a refused sign-in a sign-in failure", () => {
    expect(() =>
      parseCodexRun(fixture("codex-login-failure.jsonl"), "", null),
    ).toThrow(
      expect.objectContaining({
        engine: "codex",
        failure: "login",
        message: expect.stringContaining("401 Unauthorized"),
      }),
    );
  });

  it("fails a turn that failed, even with an answer file", () => {
    expect(() =>
      parseCodexRun(fixture("codex-login-failure.jsonl"), "", ANSWER),
    ).toThrow(expect.objectContaining({ failure: "login" }));
  });

  it("fails when the answer file isn't JSON", () => {
    expect(() =>
      parseCodexRun(fixture("codex-stream.jsonl"), "", "Here are the links"),
    ).toThrow(expect.objectContaining({ failure: "failed" }));
  });
});

describe("codexFailure", () => {
  it.each([
    ["You've hit your usage limit. Try again in 3 hours.", "limit"],
    ["unexpected status 429 Too Many Requests", "limit"],
    ["Your refresh token has already been used", "login"],
    ["stream disconnected before completion", "failed"],
  ] as const)("%s is %s", (message, failure) => {
    expect(codexFailure(message).failure).toBe(failure);
  });
});

describe("runCodex", () => {
  it("keeps the sign-in Codex renewed", async () => {
    const { box, files, runs } = fakeCliBox((_, written) => {
      written.set(`${BOX_DIR}/answer.json`, ANSWER);
      written.set(`${BOX_DIR}/codex/auth.json`, `${AUTH} `);
      return { stdout: fixture("codex-stream.jsonl") };
    });
    const keepLogin = vi.fn(async () => {});
    const reply = await runCodex(box, task, AUTH, keepLogin);

    expect(files.get(`${BOX_DIR}/schema.json`)).toBe(
      JSON.stringify(task.schema),
    );
    expect(runs[0].env).toEqual({ CODEX_HOME: `${BOX_DIR}/codex` });
    expect(keepLogin).toHaveBeenCalledWith(`${AUTH} `);
    expect(reply.output).toEqual(JSON.parse(ANSWER));
  });

  it("never reads an earlier task's answer as this one's", async () => {
    let run = 0;
    const { box } = fakeCliBox((_, written) => {
      run++;
      if (run === 1) {
        written.set(`${BOX_DIR}/answer.json`, ANSWER);
        return { stdout: fixture("codex-stream.jsonl") };
      }
      // The second task is cut off before Codex writes its answer.
      return { stdout: '{"type":"thread.started","thread_id":"t2"}\n' };
    });
    const keepLogin = async () => {};
    await runCodex(box, task, AUTH, keepLogin);
    await expect(runCodex(box, task, AUTH, keepLogin)).rejects.toMatchObject({
      failure: "failed",
    });
  });

  it("keeps a renewed sign-in even when the step fails, and not an unchanged one", async () => {
    const renewed = fakeCliBox((_, written) => {
      written.set(`${BOX_DIR}/codex/auth.json`, `${AUTH}\n`);
      return { stdout: fixture("codex-login-failure.jsonl") };
    });
    const keepRenewed = vi.fn(async () => {});
    await expect(
      runCodex(renewed.box, task, AUTH, keepRenewed),
    ).rejects.toMatchObject({ failure: "login" });
    expect(keepRenewed).toHaveBeenCalledOnce();

    const unchanged = fakeCliBox(() => ({
      stdout: fixture("codex-login-failure.jsonl"),
    }));
    const keepUnchanged = vi.fn(async () => {});
    await expect(
      runCodex(unchanged.box, task, AUTH, keepUnchanged),
    ).rejects.toMatchObject({ failure: "login" });
    expect(keepUnchanged).not.toHaveBeenCalled();
  });
});
