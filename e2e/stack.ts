import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

/** The repository root, where the compose files are. */
export const ROOT = resolve(__dirname, "..");

/** Its own compose project, so it never touches the real stack's data. */
export const PROJECT = "job-agent-smoke";

/** The smoke stack's values from e2e/smoke.env: ports, keys, the owner. */
export function smokeEnv(): Record<string, string> {
  const text = readFileSync(join(ROOT, "e2e", "smoke.env"), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * Runs `docker compose` on the smoke project. SMOKE_COMPOSE_FILES adds
 * compose files, separated like PATH, for a machine that needs its own
 * build settings.
 */
export function compose(...args: string[]): void {
  const extra = (process.env.SMOKE_COMPOSE_FILES ?? "")
    .split(delimiter)
    .filter(Boolean);
  const files = ["compose.yml", "compose.smoke.yml", ...extra].flatMap(
    (file) => ["-f", file],
  );
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      PROJECT,
      "--env-file",
      join("e2e", "smoke.env"),
      ...files,
      "--profile",
      "app",
      ...args,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} exited with ${result.status}.`,
    );
  }
}
