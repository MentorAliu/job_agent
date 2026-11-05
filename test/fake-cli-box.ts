import type { CliBox, CommandResult } from "@/lib/claude/cli/box";

/** The fake box's folder. */
export const BOX_DIR = "/box";

type Run = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
};

/**
 * A box for tests: it keeps the files written to it and answers each
 * command with `answer`, which can also leave files behind, as an agent
 * writing its answer does.
 */
export function fakeCliBox(
  answer: (
    run: Run,
    files: Map<string, string>,
  ) => Partial<CommandResult> | Promise<Partial<CommandResult>>,
) {
  const files = new Map<string, string>();
  const runs: Run[] = [];
  const box: CliBox = {
    dir: BOX_DIR,
    async writeFiles(written) {
      for (const file of written) files.set(file.path, file.content);
    },
    async run(cmd, args, options) {
      const run = { cmd, args, ...options };
      runs.push(run);
      const result = await answer(run, files);
      return { exitCode: 0, stdout: "", stderr: "", ...result };
    },
    async readFile(path) {
      return files.get(path) ?? null;
    },
  };
  return { box, files, runs };
}
