// Sets up your own copy of Job Agent and starts it, in one command:
//
//   node scripts/setup.mjs
//
// It checks Docker is running (and starts Docker Desktop if it isn't), writes
// .env from .env.example with fresh secrets, asks what the agents run on
// (your Claude or ChatGPT plan first, an API key if you'd rather), builds and
// starts the app in Docker, and opens it in your browser with the one-time
// setup code that creates your account already filled in. The app takes your
// time zone from the browser when you finish setting it up.
//
// Run it again any time, for example after changing .env or a `git pull`:
// values already in .env are kept, so the database password and the secret
// that encrypts your saved keys never change, and the app is rebuilt and
// restarted with them.
//
//   --no-start   only write .env and print the setup code (for `pnpm dev`)
//   --no-open    start the app, but don't open the browser
//
// Without Node on your computer, `docker compose run --rm setup` writes .env
// the same way, and prints the command that starts the app.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  chownSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");
const EXAMPLE_FILE = join(ROOT, ".env.example");

/** The compose project name in compose.yml, unless .env names another. */
export const DEFAULT_PROJECT = "job-agent";

/** Compose 2.24 reads compose.yml's optional env_file. */
const MIN_COMPOSE = [2, 24];

/** How long to wait for Docker Desktop to start, and then for the app. */
const DOCKER_START_MS = 3 * 60_000;
const APP_START_MS = 3 * 60_000;

/** A copy of setupCodeFor in lib/auth/setup-code.ts; a test keeps them equal. */
export function setupCodeFor(secret) {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const digest = createHmac("sha256", secret)
    .update("job-agent setup code")
    .digest();
  const code = Array.from(digest.subarray(0, 8), (byte) =>
    ALPHABET.charAt(byte & 31),
  ).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** KEY=value lines, ignoring comments. */
function readValues(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

/** Sets KEY=value where KEY= is, or adds it at the end. */
function setValue(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, "m");
  return line.test(text)
    ? text.replace(line, `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;
}

const hex = (bytes) => randomBytes(bytes).toString("hex");

/**
 * What the agents can run on, in the order setup offers them: a plan's
 * command-line agent first, an API, paid per call, after. Matches
 * ENGINE_CHOICE_ORDER in lib/schemas/settings.ts.
 */
export const ENGINE_CHOICES = [
  {
    engine: "claude_code",
    command: "claude",
    label: "Claude Code, on your Claude Pro or Max plan (no API cost)",
  },
  {
    engine: "codex",
    command: "codex",
    label: "Codex, on your ChatGPT plan (no API cost)",
  },
  {
    engine: "claude_api",
    label: "Claude API, with your own key (paid per call)",
  },
  {
    engine: "openai_api",
    label: "OpenAI API, with your own key (paid per call)",
  },
];

/**
 * The choice Enter picks: the first plan whose agent is on this computer
 * (`installed` lists their commands), else Claude Code. A number from 1.
 */
export function defaultChoice(installed) {
  const index = ENGINE_CHOICES.findIndex(
    (choice) => choice.command && installed.includes(choice.command),
  );
  return index >= 0 ? index + 1 : 1;
}

/** The engine an answer picks: Enter picks `fallback`. Null for anything else. */
export function engineFor(answer, fallback = 1) {
  const text = answer.trim() || String(fallback);
  const choice = /^\d$/.test(text) ? ENGINE_CHOICES[Number(text) - 1] : null;
  return choice?.engine ?? null;
}

/**
 * The .env line an API key goes on, from how it starts: sk-ant- is Claude's,
 * any other sk- is OpenAI's. Null when it's neither.
 */
export function apiKeyName(key) {
  if (key.startsWith("sk-ant-")) return "ANTHROPIC_API_KEY";
  if (key.startsWith("sk-")) return "OPENAI_API_KEY";
  return null;
}

/** Whether a command runs on this computer, such as `claude --version`. */
function commandRuns(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    // npm installs claude and codex as .cmd files on Windows, which need a shell.
    shell: process.platform === "win32",
    timeout: 20_000,
  });
  return result.status === 0;
}

/**
 * Asks what the agents run on and for its sign-in or key, and offers an
 * optional API key to fall back on when a plan can't run a step. Returns
 * the .env lines to set. `ask` prints a question and returns the answer.
 */
async function chooseEngine(ask, values) {
  const has = (key) => Boolean(values.get(key));
  const set = [];
  const installed = ENGINE_CHOICES.flatMap((choice) =>
    choice.command && commandRuns(choice.command) ? [choice.command] : [],
  );
  const fallback = defaultChoice(installed);
  console.log(
    [
      "",
      "What should the agents run on? You can change it later in Settings.",
      ...ENGINE_CHOICES.map(
        (choice, index) =>
          `  ${index + 1}. ${choice.label}${
            choice.command && installed.includes(choice.command)
              ? ", found on this computer"
              : ""
          }`,
      ),
    ].join("\n"),
  );
  let engine = null;
  while (!engine) {
    engine = engineFor(await ask(`Pick 1-4 [${fallback}]: `), fallback);
  }
  set.push(["AGENT_ENGINE", engine]);

  const paste = async (key, question) => {
    const value = (await ask(question)).trim();
    if (value) set.push([key, value]);
  };
  if (engine === "claude_code" && !has("CLAUDE_CODE_OAUTH_TOKEN")) {
    if (installed.includes("claude")) {
      const run = (
        await ask(
          "\nSign Claude Code in now? It runs `claude setup-token`, which opens your browser to sign in to your Claude account. [Y/n] ",
        )
      ).trim();
      if (!/^n/i.test(run)) {
        spawnSync("claude", ["setup-token"], {
          stdio: "inherit",
          shell: process.platform === "win32",
        });
      }
    } else {
      console.log(
        "\nInstall Claude Code (https://code.claude.com), then run `claude setup-token` in another terminal and sign in with your Claude account. It prints a token.",
      );
    }
    await paste(
      "CLAUDE_CODE_OAUTH_TOKEN",
      "Paste the token it printed (sk-ant-oat01-...), or press Enter to add it later: ",
    );
  } else if (engine === "codex") {
    console.log(
      "\nYou'll sign Codex in from the app, in its first step: AI provider, Codex.",
    );
  } else if (engine === "claude_api" && !has("ANTHROPIC_API_KEY")) {
    await paste(
      "ANTHROPIC_API_KEY",
      "\nPaste your Claude API key (platform.claude.com), or press Enter to add it in the app: ",
    );
  } else if (engine === "openai_api" && !has("OPENAI_API_KEY")) {
    await paste(
      "OPENAI_API_KEY",
      "\nPaste your OpenAI API key (platform.openai.com), or press Enter to add it in the app: ",
    );
  }

  const plan = engine === "claude_code" || engine === "codex";
  if (plan && !has("ANTHROPIC_API_KEY") && !has("OPENAI_API_KEY")) {
    console.log(
      "\nAn API key is optional. With one, a step your plan can't run, for example at its usage limit, runs on the API instead, within your monthly budget.",
    );
    const key = (
      await ask(
        "Paste a Claude (sk-ant-...) or OpenAI (sk-...) API key, or press Enter to skip: ",
      )
    ).trim();
    const name = apiKeyName(key);
    if (name) set.push([name, key]);
    else if (key) console.log("That isn't an API key, so it's left out.");
  }
  return set;
}

/**
 * Fills the secrets `text` is missing. `fresh` is true for a new .env made
 * from .env.example. Returns the new text, every value, and the keys it set.
 */
export function fillEnv(text, fresh) {
  const values = readValues(text);
  const missing = (key) => !values.get(key);
  const changed = [];
  const set = (key, value) => {
    text = setValue(text, key, value);
    values.set(key, value);
    changed.push(key);
  };

  if (missing("BETTER_AUTH_SECRET")) set("BETTER_AUTH_SECRET", hex(32));
  // Only for a new .env: an existing database keeps the password it began with.
  if (fresh) {
    const password = hex(16);
    set("POSTGRES_PASSWORD", password);
    set(
      "DATABASE_URL",
      `postgres://jobagent:${password}@localhost:5432/jobagent`,
    );
  }
  if (missing("INNGEST_EVENT_KEY")) set("INNGEST_EVENT_KEY", hex(16));
  if (missing("INNGEST_SIGNING_KEY")) set("INNGEST_SIGNING_KEY", hex(32));
  return { text, values, changed };
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

/** Whether a `docker compose version --short` answer is new enough. */
export function composeVersionOk(version) {
  const [major = 0, minor = 0] = String(version)
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  return (
    major > MIN_COMPOSE[0] ||
    (major === MIN_COMPOSE[0] && minor >= MIN_COMPOSE[1])
  );
}

/**
 * The compose project for a new .env: the usual one, unless an earlier copy
 * left its database behind under that name. That database has a password
 * this .env doesn't know, so the new copy gets a name of its own and the old
 * data is left alone.
 */
export function projectFor(volumes) {
  const taken = new Set(volumes);
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? DEFAULT_PROJECT : `${DEFAULT_PROJECT}-${n}`;
    if (!taken.has(`${name}_pgdata`)) return name;
  }
  return `${DEFAULT_PROJECT}-${hex(3)}`;
}

/** The first port from `preferred` on that `isFree` says is free. */
export async function freePortFrom(preferred, isFree, tries = 50) {
  for (let port = preferred; port < preferred + tries; port++) {
    if (await isFree(port)) return port;
  }
  return null;
}

/** Whether nothing on this computer listens on the port. */
async function portFree(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const server = createServer();
      server.once("error", (error) =>
        // A computer without IPv6 can't have anything listening on it.
        resolve(error.code !== "EADDRINUSE" && error.code !== "EACCES"),
      );
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, host);
    });
  return (await tryHost("127.0.0.1")) && (await tryHost("::1"));
}

/** The address the app opens on, with the setup code for the sign-up form. */
export function setupUrl(port, code) {
  return `http://localhost:${port}/sign-in#setup-code=${code}`;
}

/** How to open a link in the default browser on this kind of computer. */
export function browserCommand(platform, url) {
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Opens a link in the default browser, and resolves whether it did as far as
 * setup can tell: an opener that's missing, or fails straight away, didn't.
 */
function openBrowser(url) {
  const { command, args } = browserCommand(process.platform, url);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: "ignore", detached: true });
    } catch {
      resolve(false);
      return;
    }
    // Openers hand the link to the browser and exit. One still running after
    // a few seconds is showing the browser itself, so the link is open.
    const timer = setTimeout(() => {
      child.unref();
      resolve(true);
    }, 3000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs docker with `args`, quietly, and returns what it printed. */
function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    ...options,
  });
  return {
    ok: !result.error && result.status === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
    missing: result.error?.code === "ENOENT",
  };
}

/** Starts Docker Desktop, where it's installed in the usual place. */
function startDockerDesktop() {
  if (process.platform === "darwin") {
    return (
      spawnSync("open", ["-a", "Docker"], { stdio: "ignore" }).status === 0
    );
  }
  if (process.platform === "win32") {
    const app = join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    );
    if (!existsSync(app)) return false;
    spawn(app, [], { stdio: "ignore", detached: true }).unref();
    return true;
  }
  return false;
}

class SetupError extends Error {}

/**
 * Makes sure Docker and Compose are there and running, starting Docker
 * Desktop when it's installed but not running.
 */
async function ensureDocker() {
  if (docker(["--version"]).missing) {
    throw new SetupError(
      [
        "Docker isn't installed. Install Docker Desktop, start it once, then run setup again:",
        "  https://www.docker.com/products/docker-desktop/",
      ].join("\n"),
    );
  }
  if (!docker(["info"]).ok) {
    if (!startDockerDesktop()) {
      throw new SetupError(
        process.platform === "linux"
          ? "Docker isn't running. Start it (for example `sudo systemctl start docker`), then run setup again."
          : "Docker isn't running. Start Docker Desktop, then run setup again.",
      );
    }
    console.log("Starting Docker Desktop. This can take a minute...");
    const deadline = Date.now() + DOCKER_START_MS;
    while (!docker(["info"]).ok) {
      if (Date.now() > deadline) {
        throw new SetupError(
          "Docker Desktop didn't start. Open it, wait until it says it's running, then run setup again.",
        );
      }
      await sleep(3000);
    }
  }
  const compose = docker(["compose", "version", "--short"]);
  if (!compose.ok || !composeVersionOk(compose.out)) {
    throw new SetupError(
      `Setup needs Docker Compose ${MIN_COMPOSE.join(".")} or newer${
        compose.ok ? ` (this computer has ${compose.out})` : ""
      }. Update Docker Desktop, then run setup again.`,
    );
  }
}

/** The compose services of `project` running now. */
function runningServices(project) {
  const result = docker([
    "compose",
    "-p",
    project,
    "--profile",
    "app",
    "--profile",
    "dev",
    "ps",
    "--services",
    "--status",
    "running",
  ]);
  return new Set(result.ok ? result.out.split(/\s+/).filter(Boolean) : []);
}

/** The host ports compose.yml publishes, and the services behind them. */
const PORTS = [
  { key: "APP_PORT", preferred: 3000, services: ["web"] },
  { key: "DB_PORT", preferred: 5432, services: ["db"] },
  {
    key: "INNGEST_PORT",
    preferred: 8288,
    services: ["inngest", "inngest-dev"],
  },
];

/**
 * Picks the compose project and free ports, and returns the .env lines to
 * set. A port this copy's own containers hold is kept.
 */
async function planDocker(values, fresh) {
  const set = [];
  let project = values.get("COMPOSE_PROJECT_NAME") || DEFAULT_PROJECT;
  if (fresh) {
    const volumes = docker(["volume", "ls", "--quiet"]);
    const picked = projectFor(volumes.ok ? volumes.out.split(/\s+/) : []);
    if (picked !== project) {
      console.log(
        `\nAn earlier copy's database is still in Docker (${project}_pgdata). It's left as it is: this copy keeps its data in ${picked}_pgdata.`,
      );
      project = picked;
      set.push(["COMPOSE_PROJECT_NAME", project]);
    }
  }
  const running = runningServices(project);
  for (const { key, preferred, services } of PORTS) {
    const current = Number(values.get(key)) || preferred;
    if (services.some((service) => running.has(service))) continue;
    if (await portFree(current)) continue;
    const port = await freePortFrom(current + 1, portFree);
    if (!port) {
      throw new SetupError(
        `Port ${current} is taken, and so are the ones after it. Set ${key} in .env to a free port, then run setup again.`,
      );
    }
    console.log(`Port ${current} is taken, so ${key} is ${port}.`);
    set.push([key, String(port)]);
    if (key === "APP_PORT") {
      set.push(["BETTER_AUTH_URL", `http://localhost:${port}`]);
    }
    if (key === "INNGEST_PORT") {
      // For `pnpm dev`; the app in Docker reaches Inngest inside Docker.
      set.push(["INNGEST_BASE_URL", `http://localhost:${port}`]);
    }
    if (key === "DB_PORT") {
      const url = values.get("DATABASE_URL") ?? "";
      if (/@localhost:\d+\//.test(url)) {
        set.push([
          "DATABASE_URL",
          url.replace(/@localhost:\d+\//, `@localhost:${port}/`),
        ]);
      }
    }
  }
  return set;
}

/**
 * Waits for the app to answer, and returns its sign-in page. Null when it
 * didn't answer within APP_START_MS.
 */
async function waitForApp(port) {
  const deadline = Date.now() + APP_START_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/sign-in`, {
        redirect: "manual",
      });
      if (response.status < 500) return await response.text();
    } catch {
      // Not listening yet.
    }
    await sleep(2000);
  }
  return null;
}

/**
 * Whether the sign-in page is for signing in: the copy's account exists.
 * Anything else, even a page setup can't read, gets the setup code.
 */
export function accountExists(signInPage) {
  return /data-sign-in-mode="sign-in"/.test(signInPage);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** What to do, from the command line and where setup runs. */
export function optionsFrom(argv, env) {
  const inContainer = env.SETUP_IN_CONTAINER === "1";
  return {
    inContainer,
    start: !inContainer && !argv.includes("--no-start"),
    open: !argv.includes("--no-open") && !env.CI,
  };
}

/** What still needs doing for the engine .env picked, if anything. */
function engineNote(values) {
  const engine = values.get("AGENT_ENGINE");
  const missing = (key) => !values.get(key);
  if (engine === "claude_code" && missing("CLAUDE_CODE_OAUTH_TOKEN")) {
    return "Claude Code isn't signed in yet: run `claude setup-token`, put the token in .env as CLAUDE_CODE_OAUTH_TOKEN, then run setup again.";
  }
  return null;
}

function writeEnv(text) {
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
  // In a container this runs as root: give .env to whoever owns the folder.
  if (process.getuid?.() === 0) {
    const { uid, gid } = statSync(ROOT);
    chownSync(ENV_FILE, uid, gid);
  }
}

async function main() {
  const options = optionsFrom(process.argv.slice(2), process.env);
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 20) {
    throw new SetupError(
      `Setup needs Node.js 20 or newer (this is ${process.versions.node}). Install it from https://nodejs.org, or run \`docker compose run --rm setup\`.`,
    );
  }
  if (options.start) await ensureDocker();

  const fresh = !existsSync(ENV_FILE);
  const filled = fillEnv(
    readFileSync(fresh ? EXAMPLE_FILE : ENV_FILE, "utf8"),
    fresh,
  );
  const { values, changed } = filled;
  let text = filled.text;
  const set = (key, value) => {
    text = setValue(text, key, value);
    values.set(key, value);
    changed.push(key);
  };

  // Asked once: after that, .env and Settings are where it changes.
  if (process.stdin.isTTY && !values.get("AGENT_ENGINE")) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const ask = (question) => prompt.question(question);
      for (const [key, value] of await chooseEngine(ask, values)) {
        set(key, value);
      }
    } finally {
      prompt.close();
    }
  }

  if (options.start) {
    for (const [key, value] of await planDocker(values, fresh)) set(key, value);
  }
  if (changed.length > 0) writeEnv(text);

  const code = setupCodeFor(values.get("BETTER_AUTH_SECRET"));
  const port = values.get("APP_PORT") || "3000";
  const note = engineNote(values);
  const saved = fresh
    ? "Created .env with fresh secrets."
    : changed.length > 0
      ? `Added to .env: ${[...new Set(changed)].join(", ")}.`
      : ".env already has everything it needs.";

  if (!options.start) {
    console.log(
      [
        "",
        saved,
        "",
        `  Setup code: ${code}`,
        "  You need it once, to create your account. It's also in the app's log.",
        "",
        "Next:",
        options.inContainer
          ? "  docker compose --profile app up -d --build"
          : "  node scripts/setup.mjs   (starts the app in Docker)",
        `  then open http://localhost:${port}`,
        ...(note ? ["", note] : []),
      ].join("\n"),
    );
    return;
  }

  console.log(
    `\n${saved}\nBuilding and starting the app in Docker. The first time takes a few minutes.\n`,
  );
  // The development profile's Inngest holds the port the app's own one needs.
  const project = values.get("COMPOSE_PROJECT_NAME") || DEFAULT_PROJECT;
  if (runningServices(project).has("inngest-dev")) {
    console.log("Stopping the development Inngest: the app runs its own.\n");
    docker([
      "compose",
      "-p",
      project,
      "--profile",
      "dev",
      "stop",
      "inngest-dev",
    ]);
  }
  const up = spawnSync(
    "docker",
    ["compose", "--profile", "app", "up", "--detach", "--build"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (up.status !== 0) {
    throw new SetupError(
      "Docker couldn't start the app (see above). Fix what it says, then run setup again: it keeps your .env.",
    );
  }
  const signInPage = await waitForApp(port);
  if (signInPage === null) {
    throw new SetupError(
      `The app didn't answer on http://localhost:${port}. See what it says with \`docker compose logs web\`, then run setup again.`,
    );
  }

  const home = `http://localhost:${port}`;
  const signedUp = accountExists(signInPage);
  const url = signedUp ? home : setupUrl(port, code);
  const opened = options.open && (await openBrowser(url));
  console.log(
    [
      "",
      `Job Agent is running at ${home}`,
      "",
      ...(signedUp
        ? [
            `  ${opened ? "Setup just opened it in your browser. " : ""}Sign in with your email and password.`,
          ]
        : [
            `  Setup code: ${code}`,
            `  To create your account, open ${url}`,
            `  ${opened ? "(setup just opened it in your browser) " : ""}and add your email and a password. The code is filled in there.`,
            "",
            "The app then sets up the rest with you: your AI provider, your CV and what you're looking for. It takes your time zone from this computer.",
          ]),
      ...(note ? ["", note] : []),
      "",
      "Later:",
      "  Stop it:              docker compose --profile app stop",
      "  Start it again:       node scripts/setup.mjs",
      "  Forgot your password: docker compose run --rm reset-password",
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
