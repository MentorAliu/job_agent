// PostToolUse hook for Edit|Write: formats the file Claude just changed with the
// project's Prettier. It never blocks. Calling the Prettier script through Node
// (no shell) means it behaves the same in PowerShell, Git Bash and Linux.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const FORMATTABLE = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md", ".yml", ".yaml",
]);

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const file = input?.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const prettier = join(root, "node_modules", "prettier", "bin", "prettier.cjs");

const skip =
  !file ||
  !existsSync(file) ||
  !existsSync(prettier) ||
  !FORMATTABLE.has(extname(file).toLowerCase()) ||
  /[\\/](node_modules|\.next|components[\\/]ui)[\\/]/.test(file);

if (!skip) {
  spawnSync(process.execPath, [prettier, "--write", "--log-level", "warn", "--ignore-unknown", file], {
    cwd: root,
    stdio: "ignore",
    timeout: 25_000,
  });
}
process.exit(0);
