import "server-only";

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

import { ENGINE_NAMES, type CliEngine } from "@/lib/schemas/settings";

import type { CommandResult, OpenBox } from "./box";
import { CliEngineError } from "./task";

// Off Vercel, such as in the Docker copy, a command-line agent runs on the
// machine the app runs on, in a new empty folder that is removed after the
// step. The agent gets none of the app's settings: not its database, keys or
// files, only what lets a program run and reach the internet. What it can do
// is limited by how it's started (claude-code.ts, codex.ts): no tool that
// runs commands, opens files or fetches pages, only web search on its own
// servers.

/** What an agent keeps from the app's environment. Nothing secret. */
const KEPT_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  // A proxy the machine needs to reach the internet, and its certificates.
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // What Windows needs to start a program.
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
];

/** The most output kept from a command, so a runaway agent can't fill memory. */
const MAX_OUTPUT_CHARS = 8_000_000;

/** The shell's exit code for a command it can't find. */
const NOT_FOUND = 127;

const INSTALL: Record<CliEngine, string> = {
  claude_code: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
};

/** The environment an agent runs with: the box as its home, and `extra`. */
export function agentEnv(
  dir: string,
  extra: Record<string, string> = {},
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT_ENV) {
    const value = env[name];
    if (value !== undefined) kept[name] = value;
  }
  // Its own home, so it reads no settings, sign-ins or instructions left
  // there by anything else.
  return { ...kept, HOME: dir, USERPROFILE: dir, ...extra };
}

/** Throws unless `path` is inside the box's folder. */
function inside(dir: string, path: string): string {
  const rel = relative(dir, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${path} is outside the agent's folder.`);
  }
  return path;
}

/** Runs a command in `dir` and stops it, with all it started, after `timeoutMs`. */
export function runCommand(
  cmd: string,
  args: string[],
  {
    dir,
    env,
    timeoutMs,
  }: { dir: string; env: Record<string, string>; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const group = process.platform !== "win32";
    const child = spawn(cmd, args, {
      cwd: dir,
      // Next.js types every environment as having NODE_ENV; this one has none.
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a timeout stops whatever it started too.
      detached: group,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });

    let timedOut = false;
    const stop = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // It already ended.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\nStopped after ${Math.round(timeoutMs / 1000)} s.`;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Runs `work` in a new empty folder on this machine, and removes the folder
 * afterwards. An agent that isn't installed here throws a CliEngineError.
 */
export const withLocalBox: OpenBox = async (engine, _timeout, work) => {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), "job-agent-"));
  } catch (error) {
    throw new CliEngineError(
      engine,
      "sandbox",
      `The folder the agent runs in couldn't be made: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const name = ENGINE_NAMES[engine];
  try {
    return await work({
      dir,
      async writeFiles(files) {
        for (const file of files) {
          const path = inside(dir, file.path);
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path, file.content, { mode: file.mode ?? 0o600 });
        }
      },
      async run(cmd, args, { env, timeoutMs }) {
        let result: CommandResult;
        try {
          result = await runCommand(cmd, args, {
            dir,
            env: agentEnv(dir, env),
            timeoutMs,
          });
        } catch (error) {
          throw new CliEngineError(
            engine,
            "sandbox",
            `${name} couldn't start here: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (result.exitCode === NOT_FOUND) {
          throw new CliEngineError(
            engine,
            "setup",
            `${name} isn't installed where the app runs. The Docker copy has it; for pnpm dev, run ${INSTALL[engine]}.`,
          );
        }
        return result;
      },
      async readFile(path) {
        try {
          return await readFile(inside(dir, path), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
