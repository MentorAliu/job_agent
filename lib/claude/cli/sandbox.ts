import "server-only";

import { Sandbox } from "@vercel/sandbox";

import type { CliEngine } from "@/lib/schemas/settings";

import type { OpenBox } from "./box";
import { CliEngineError } from "./task";

// On Vercel, each step that uses a command-line agent starts a short-lived
// Vercel Sandbox: a microVM whose default image has Claude Code and Codex
// installed. It reaches only the agent's own servers, so a posting that
// tells the agent to send something elsewhere can't. On Vercel the SDK signs
// in with the project's OIDC token.

/** Where a step's files go inside the sandbox. */
export const WORK_DIR = "/vercel/sandbox/job";

/**
 * The hosts each agent talks to. Web search runs on these servers too, so
 * nothing else is needed.
 */
export const ENGINE_HOSTS: Record<CliEngine, string[]> = {
  claude_code: ["anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai"],
  codex: ["chatgpt.com", "*.chatgpt.com", "openai.com", "*.openai.com"],
};

/**
 * Runs `work` in a new sandbox that reaches only the engine's servers, and
 * stops the sandbox afterwards. A sandbox that can't start throws a
 * CliEngineError.
 */
export const withVercelSandbox: OpenBox = async (engine, timeout, work) => {
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      persistent: false,
      region: "fra1",
      resources: { vcpus: 1 },
      timeout,
      networkPolicy: { allow: ENGINE_HOSTS[engine] },
      tags: { app: "job-agent", engine },
    });
  } catch (error) {
    throw new CliEngineError(
      engine,
      "sandbox",
      `The sandbox the agent runs in couldn't start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return await work({
      dir: WORK_DIR,
      async writeFiles(files) {
        await sandbox.writeFiles(files);
      },
      async run(cmd, args, { env, timeoutMs }) {
        const result = await sandbox.runCommand({
          cmd,
          args,
          cwd: WORK_DIR,
          env,
          timeoutMs,
        });
        const [stdout, stderr] = await Promise.all([
          result.stdout(),
          result.stderr(),
        ]);
        return { exitCode: result.exitCode, stdout, stderr };
      },
      async readFile(path) {
        const buffer = await sandbox.readFileToBuffer({ path });
        return buffer ? buffer.toString("utf8") : null;
      },
    });
  } finally {
    await sandbox.stop().catch(() => {});
  }
};
