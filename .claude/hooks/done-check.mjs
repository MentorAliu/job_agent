// Stop hook: Claude can end a turn only when typecheck, lint and tests pass.
//
// - Exit 0: allow the stop. Exit 2: block it, and Claude reads stderr and keeps working.
// - Skips only when nothing changed since the last green run: same commit and same
//   working-tree changes (fingerprint stored in .claude/.done-check-pass). A new
//   commit is checked too, so committing failing code doesn't get past the hook.
// - If Claude tries to stop again without changing anything since the last
//   failure, the stop is allowed so the session can't loop. Claude Code also caps
//   consecutive blocks at 8.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const passStamp = join(root, ".claude", ".done-check-pass");
const failStamp = join(root, ".claude", ".done-check-fail");
const isWindows = process.platform === "win32";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  // No or invalid input: run the checks anyway.
}

const git = (args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function fingerprint() {
  const status = git(["status", "--porcelain=v1", "-uall"]);
  if (status.status !== 0) return null; // not a git repo: always check
  const head = (git(["rev-parse", "-q", "--verify", "HEAD"]).stdout ?? "").trim();
  if (!status.stdout.trim()) return `clean:${head}`;
  const hash = createHash("sha256");
  hash.update(head);
  hash.update(status.stdout);
  hash.update(git(["diff", "HEAD", "--no-ext-diff"]).stdout ?? "");
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).stdout.split("\n").filter(Boolean);
  for (const rel of untracked) {
    const file = join(root, rel);
    try {
      if (statSync(file).size < 1_000_000) hash.update(rel).update(readFileSync(file));
    } catch {
      // File vanished between listing and reading: ignore it.
    }
  }
  return hash.digest("hex");
}

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
const current = fingerprint();

if (current && current === read(passStamp)) process.exit(0);
if (current && input.stop_hook_active && current === read(failStamp)) process.exit(0);

const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
const checks = ["typecheck", "lint", "test"].filter((name) => scripts[name]);

for (const name of checks) {
  const run = spawnSync("pnpm", ["run", "--silent", name], {
    cwd: root,
    encoding: "utf8",
    shell: isWindows, // pnpm is a .cmd shim on Windows; the arguments are fixed strings
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    if (current) writeFileSync(failStamp, current);
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim().split("\n").slice(-60).join("\n");
    process.stderr.write(
      `Done-when check failed: pnpm run ${name}\n\n${output}\n\n` +
        "Fix the cause (don't disable the check), then finish again.\n",
    );
    process.exit(2);
  }
}

if (current) writeFileSync(passStamp, current);
process.exit(0);
