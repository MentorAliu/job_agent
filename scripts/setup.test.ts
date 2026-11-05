import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENGINE_CHOICE_ORDER } from "@/lib/schemas/settings";

import {
  accountExists,
  apiKeyName,
  browserCommand,
  composeVersionOk,
  defaultChoice,
  ENGINE_CHOICES,
  engineFor,
  fillEnv,
  freePortFrom,
  optionsFrom,
  projectFor,
  setupUrl,
} from "./setup.mjs";

const EXAMPLE = readFileSync(join(__dirname, "..", ".env.example"), "utf8");

function valueOf(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
}

describe("fillEnv", () => {
  it("fills every secret in a new .env from .env.example", () => {
    const { text, changed } = fillEnv(EXAMPLE, true);

    expect(valueOf(text, "BETTER_AUTH_SECRET")).toMatch(/^[0-9a-f]{64}$/);
    expect(valueOf(text, "INNGEST_EVENT_KEY")).toMatch(/^[0-9a-f]{32}$/);
    expect(valueOf(text, "INNGEST_SIGNING_KEY")).toMatch(/^[0-9a-f]{64}$/);
    const password = valueOf(text, "POSTGRES_PASSWORD");
    expect(password).toMatch(/^[0-9a-f]{32}$/);
    expect(valueOf(text, "DATABASE_URL")).toBe(
      `postgres://jobagent:${password}@localhost:5432/jobagent`,
    );
    expect(changed).toEqual([
      "BETTER_AUTH_SECRET",
      "POSTGRES_PASSWORD",
      "DATABASE_URL",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
    ]);
    // The rest of the file, comments included, stays as it was.
    expect(text).toContain("# Cost guardrails (USD) for paid API calls");
    expect(valueOf(text, "APP_PORT")).toBe("3000");
  });

  it("makes new secrets for each copy", () => {
    const one = fillEnv(EXAMPLE, true).text;
    const two = fillEnv(EXAMPLE, true).text;
    expect(valueOf(one, "BETTER_AUTH_SECRET")).not.toBe(
      valueOf(two, "BETTER_AUTH_SECRET"),
    );
  });

  it("keeps what an existing .env has, including the database password", () => {
    const existing = [
      "BETTER_AUTH_SECRET=keep-this-secret",
      "POSTGRES_PASSWORD=jobagent",
      "DATABASE_URL=postgres://jobagent:jobagent@localhost:5432/jobagent",
      "INNGEST_EVENT_KEY=",
      "",
    ].join("\n");

    const { text, changed } = fillEnv(existing, false);

    expect(valueOf(text, "BETTER_AUTH_SECRET")).toBe("keep-this-secret");
    expect(valueOf(text, "POSTGRES_PASSWORD")).toBe("jobagent");
    expect(valueOf(text, "INNGEST_EVENT_KEY")).toMatch(/^[0-9a-f]{32}$/);
    // Missing lines are added at the end.
    expect(valueOf(text, "INNGEST_SIGNING_KEY")).toMatch(/^[0-9a-f]{64}$/);
    expect(changed).toEqual(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]);
  });

  it("changes nothing when everything is there", () => {
    const { text } = fillEnv(EXAMPLE, true);
    expect(fillEnv(text, false)).toMatchObject({ text, changed: [] });
  });
});

describe("engineFor", () => {
  it("offers the engines in the app's order, a plan first", () => {
    expect(ENGINE_CHOICES.map((choice) => choice.engine)).toEqual(
      ENGINE_CHOICE_ORDER,
    );
  });

  it("picks by number, the suggested one on Enter, and nothing for anything else", () => {
    expect(engineFor("")).toBe("claude_code");
    expect(engineFor("", 2)).toBe("codex");
    expect(engineFor(" 2 ")).toBe("codex");
    expect(engineFor("4", 2)).toBe("openai_api");
    expect(engineFor("5")).toBeNull();
    expect(engineFor("0")).toBeNull();
    expect(engineFor("codex")).toBeNull();
  });

  it("suggests the plan whose agent is on this computer, Claude Code first", () => {
    expect(defaultChoice([])).toBe(1);
    expect(defaultChoice(["codex"])).toBe(2);
    expect(defaultChoice(["codex", "claude"])).toBe(1);
  });
});

describe("apiKeyName", () => {
  it("tells a Claude key from an OpenAI key", () => {
    expect(apiKeyName("sk-ant-api03-abc")).toBe("ANTHROPIC_API_KEY");
    expect(apiKeyName("sk-proj-abc")).toBe("OPENAI_API_KEY");
    expect(apiKeyName("hello")).toBeNull();
  });
});

describe("starting the app in Docker", () => {
  it("needs Compose 2.24 or newer", () => {
    expect(composeVersionOk("2.24.0")).toBe(true);
    expect(composeVersionOk("v2.40.3-desktop.1")).toBe(true);
    expect(composeVersionOk("3.0.0")).toBe(true);
    expect(composeVersionOk("2.23.9")).toBe(false);
    expect(composeVersionOk("1.29.2")).toBe(false);
    expect(composeVersionOk("")).toBe(false);
  });

  it("names a new copy's project so an earlier copy's database is left alone", () => {
    expect(projectFor([])).toBe("job-agent");
    expect(projectFor(["other_pgdata", "job-agent_files"])).toBe("job-agent");
    expect(projectFor(["job-agent_pgdata"])).toBe("job-agent-2");
    expect(projectFor(["job-agent_pgdata", "job-agent-2_pgdata"])).toBe(
      "job-agent-3",
    );
  });

  it("moves to the next free port when the usual one is taken", async () => {
    const taken = new Set([3000, 3001]);
    const isFree = async (port: number) => !taken.has(port);
    expect(await freePortFrom(3000, isFree)).toBe(3002);
    expect(await freePortFrom(3100, isFree)).toBe(3100);
    expect(await freePortFrom(3000, async () => false, 5)).toBeNull();
  });

  it("opens the sign-up page with the setup code after #, which stays in the browser", () => {
    expect(setupUrl("3000", "K7QM-4XPA")).toBe(
      "http://localhost:3000/sign-in#setup-code=K7QM-4XPA",
    );
  });

  it("sends a copy in use to sign in, and any other to create the account", () => {
    expect(accountExists('<form data-sign-in-mode="sign-in">')).toBe(true);
    expect(accountExists('<form data-sign-in-mode="create">')).toBe(false);
    // A page setup can't read still gets the setup code.
    expect(accountExists("<html></html>")).toBe(false);
  });

  it("opens the browser the way each system does", () => {
    const url = "http://localhost:3000/sign-in#setup-code=K7QM-4XPA";
    expect(browserCommand("win32", url)).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    });
    expect(browserCommand("darwin", url)).toEqual({
      command: "open",
      args: [url],
    });
    expect(browserCommand("linux", url)).toEqual({
      command: "xdg-open",
      args: [url],
    });
  });

  it("only writes .env in its container, and on --no-start", () => {
    expect(optionsFrom([], {})).toEqual({
      inContainer: false,
      start: true,
      open: true,
    });
    expect(optionsFrom(["--no-start"], {})).toMatchObject({ start: false });
    expect(optionsFrom(["--no-open"], {})).toMatchObject({
      start: true,
      open: false,
    });
    expect(optionsFrom([], { SETUP_IN_CONTAINER: "1" })).toMatchObject({
      inContainer: true,
      start: false,
    });
    expect(optionsFrom([], { CI: "true" })).toMatchObject({ open: false });
  });
});
