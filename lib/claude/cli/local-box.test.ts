import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { agentEnv, runCommand, withLocalBox } from "./local-box";
import { CliEngineError } from "./task";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agentEnv", () => {
  it("keeps only what a program needs, with the box as its home", () => {
    const env = agentEnv(
      "/box",
      { CLAUDE_CODE_OAUTH_TOKEN: "token" },
      {
        PATH: "/usr/bin",
        HTTPS_PROXY: "http://proxy:3128",
        DATABASE_URL: "postgres://secret",
        ANTHROPIC_API_KEY: "sk-ant-secret",
        BETTER_AUTH_SECRET: "secret",
        HOME: "/home/owner",
      },
    );

    expect(env).toEqual({
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://proxy:3128",
      HOME: "/box",
      USERPROFILE: "/box",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
    });
  });
});

describe("runCommand", () => {
  it("stops a command that runs too long, and says so", async () => {
    const result = await runCommand("bash", ["-c", "echo started; sleep 5"], {
      dir: process.cwd(),
      env: agentEnv(process.cwd()),
      timeoutMs: 300,
    });

    expect(result.stdout).toBe("started\n");
    expect(result.stderr).toContain("Stopped after");
    expect(result.exitCode).not.toBe(0);
  });
});

describe("withLocalBox", () => {
  it("runs commands in a new folder, without the app's secrets, and removes it", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://secret");
    let dir = "";

    const seen = await withLocalBox("claude_code", 60_000, async (box) => {
      dir = box.dir;
      await box.writeFiles([
        { path: `${box.dir}/in/prompt.txt`, content: "hi" },
      ]);
      const result = await box.run(
        "bash",
        [
          "-c",
          'cat in/prompt.txt; echo " $HOME|$TOKEN|${DATABASE_URL:-none}"; echo out > answer.txt',
        ],
        { env: { TOKEN: "token" }, timeoutMs: 10_000 },
      );
      return {
        stdout: result.stdout,
        answer: await box.readFile(`${box.dir}/answer.txt`),
        missing: await box.readFile(`${box.dir}/nothing.txt`),
      };
    });

    expect(seen).toEqual({
      stdout: `hi ${dir}|token|none\n`,
      answer: "out\n",
      missing: null,
    });
    expect(existsSync(dir)).toBe(false);
  });

  it("writes and reads only inside its folder", async () => {
    await withLocalBox("codex", 60_000, async (box) => {
      await expect(
        box.writeFiles([{ path: `${box.dir}/../escape.txt`, content: "x" }]),
      ).rejects.toThrow("outside the agent's folder");
      await expect(box.readFile("/etc/hostname")).rejects.toThrow(
        "outside the agent's folder",
      );
    });
  });

  it("says how to install an agent that isn't there", async () => {
    const run = withLocalBox("codex", 60_000, (box) =>
      box.run("bash", ["-c", "exec job-agent-no-such-agent"], {
        timeoutMs: 10_000,
      }),
    );

    await expect(run).rejects.toBeInstanceOf(CliEngineError);
    await expect(run).rejects.toMatchObject({
      failure: "setup",
      message: expect.stringContaining("npm install -g @openai/codex"),
    });
  });
});
