// Copies the committed tree into a new folder as one fresh commit, with no
// history, for a new public repository. Only what's committed at HEAD goes:
// never .env, local data or anything else Git ignores.
//
//   node scripts/export-public.mjs <new-folder> [<new-repo-url>]
//
// With a repository URL, the README's clone command points at it, and it
// becomes the new folder's `origin`. Then push it yourself:
//
//   cd <new-folder> && git push -u origin main
//
// It stops before writing anything when the working tree has uncommitted
// changes, or when a committed file looks like it holds a secret.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Patterns of real keys and tokens. Tests' made-up keys are too short. */
const SECRET_PATTERNS = [
  ["an Anthropic or OpenAI key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{40,}/],
  [
    "a GitHub token",
    /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  ],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a Vercel Blob token", /\bvercel_blob_rw_[A-Za-z0-9_]{20,}/],
  ["a Neon password", /\bnpg_[A-Za-z0-9]{10,}/],
];

/** Committed files that should never be: env files other than the example. */
const SECRET_FILES = /(?:^|\/)\.env(?:\.(?!example$)[^/]*)?$|\.pem$/;

/**
 * What in `files` (path and text) looks like a secret, as "path: what"
 * lines. Empty when nothing does.
 */
export function findSecrets(files) {
  const found = [];
  for (const { path, text } of files) {
    if (SECRET_FILES.test(path)) found.push(`${path}: an env or key file`);
    for (const [what, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) found.push(`${path}: ${what}`);
    }
  }
  return found;
}

/** A git remote as the https clone URL the README shows. */
export function cloneUrl(remote) {
  const ssh = remote.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}.git`;
  const https = remote.match(
    /^https:\/\/(?:[^@/]+@)?github\.com\/(.+?)(?:\.git)?\/?$/,
  );
  return https ? `https://github.com/${https[1]}.git` : null;
}

const git = (args, cwd = ROOT) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const [target, newRemote] = process.argv.slice(2);
  if (!target) {
    fail("Usage: node scripts/export-public.mjs <new-folder> [<new-repo-url>]");
  }
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    fail(`${dir} isn't empty. Pick a new folder.`);
  }
  if (git(["status", "--porcelain"]).trim()) {
    fail(
      "Commit or stash your changes first: only what's committed is exported.",
    );
  }

  const paths = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const files = paths.flatMap((path) => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return [];
    const buffer = readFileSync(full);
    // Binary files (images, PDFs) are left out of the text checks.
    return buffer.includes(0) ? [] : [{ path, text: buffer.toString("utf8") }];
  });
  const secrets = findSecrets(files);
  if (secrets.length > 0) {
    fail(
      [
        "These committed files look like they hold secrets. Remove them, commit, and run this again:",
        ...secrets.map((line) => `  ${line}`),
      ].join("\n"),
    );
  }

  mkdirSync(dir, { recursive: true });
  // git archive writes exactly the committed files, with their modes.
  const archive = execFileSync("git", ["archive", "--format=tar", "HEAD"], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });

  if (newRemote) {
    let oldUrl = null;
    try {
      oldUrl = cloneUrl(git(["remote", "get-url", "origin"]).trim());
    } catch {
      // No origin: nothing to point elsewhere.
    }
    const newUrl = cloneUrl(newRemote) ?? newRemote;
    const readme = join(dir, "README.md");
    if (oldUrl && existsSync(readme)) {
      const text = readFileSync(readme, "utf8");
      writeFileSync(readme, text.split(oldUrl).join(newUrl));
    }
  }

  git(["init", "-q", "-b", "main"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "Job Agent: first public release"], dir);
  if (newRemote) git(["remote", "add", "origin", newRemote], dir);

  const count = git(["ls-files"], dir).split("\n").filter(Boolean).length;
  console.log(
    [
      `Exported ${count} files to ${dir} as one commit, with no history.`,
      newRemote
        ? `Next: cd ${dir} && git push -u origin main`
        : `Next: create an empty repository, then in ${dir}: git remote add origin <url> && git push -u origin main`,
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
