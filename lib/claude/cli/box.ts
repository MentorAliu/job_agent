import "server-only";

import type { CliEngine } from "@/lib/schemas/settings";

import { withLocalBox } from "./local-box";
import { withVercelSandbox } from "./sandbox";
import { CliEngineError } from "./task";

// Where a command-line agent runs a step: on Vercel, a short-lived Vercel
// Sandbox, since the agents are too big for a Vercel Function; anywhere
// else, such as the Docker copy, a new empty folder on the machine the app
// runs on. Either way the agent sees only the step's own files.

/**
 * A box lives a little under an Inngest step's 300 s, so a stuck agent is
 * stopped before the step is.
 */
export const BOX_TIMEOUT_MS = 270_000;
/** A command isn't started with less time than this left in the box. */
const MIN_COMMAND_MS = 20_000;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** What a step does in its box. */
export type CliBox = {
  /** The box's own folder. Commands run in it, and the step's files go in it. */
  dir: string;
  writeFiles(
    files: { path: string; content: string; mode?: number }[],
  ): Promise<void>;
  /** Runs a command in `dir`, so no settings from anywhere else apply. */
  run(
    cmd: string,
    args: string[],
    options: { env?: Record<string, string>; timeoutMs: number },
  ): Promise<CommandResult>;
  /** A file's text, or null when it doesn't exist. */
  readFile(path: string): Promise<string | null>;
};

/** Opens a box, runs `work` in it, and cleans it up. */
export type OpenBox = <T>(
  engine: CliEngine,
  timeoutMs: number,
  work: (box: CliBox) => Promise<T>,
) => Promise<T>;

/** Where command-line agents run: a Vercel Sandbox on Vercel, else locally. */
export function cliRunner(
  env: Record<string, string | undefined> = process.env,
): "vercel-sandbox" | "local" {
  return env.VERCEL === "1" ? "vercel-sandbox" : "local";
}

/**
 * Runs `work` in a new box for the engine and cleans the box up afterwards.
 * A box that can't start throws a CliEngineError, so the step can fall back
 * to an API. `timeoutMs` shortens its life, for a step that already spent
 * some of its time.
 */
export function withCliBox<T>(
  engine: CliEngine,
  work: (box: CliBox) => Promise<T>,
  timeoutMs: number = BOX_TIMEOUT_MS,
): Promise<T> {
  const timeout = Math.min(timeoutMs, BOX_TIMEOUT_MS);
  const open: OpenBox =
    cliRunner() === "vercel-sandbox" ? withVercelSandbox : withLocalBox;
  // Commands end before the box does, so their output can still be read.
  const deadline = Date.now() + timeout - 10_000;
  return open(engine, timeout, (box) =>
    work({
      ...box,
      async run(cmd, args, { env, timeoutMs: commandMs }) {
        const left = deadline - Date.now();
        if (left < MIN_COMMAND_MS) {
          throw new CliEngineError(
            engine,
            "sandbox",
            "The agent ran out of time before this step could run.",
          );
        }
        return box.run(cmd, args, {
          env,
          timeoutMs: Math.min(commandMs, left),
        });
      },
    }),
  );
}
