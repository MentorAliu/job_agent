import { describe, expect, it } from "vitest";

import { cloneUrl, findSecrets } from "./export-public.mjs";

describe("findSecrets", () => {
  it("finds real-looking keys, tokens and env files", () => {
    const found = findSecrets([
      { path: ".env", text: "DATABASE_URL=postgres://localhost" },
      { path: "config/.env.production", text: "" },
      {
        path: "lib/key.ts",
        text: `const key = "sk-ant-api03-${"a".repeat(80)}";`,
      },
      { path: "notes.md", text: `token ghp_${"b".repeat(36)}` },
      // Built here, so this file doesn't hold one itself.
      {
        path: "db.txt",
        text: `postgres://u:${"npg_"}${"Ab3".repeat(4)}@host/db`,
      },
    ]);
    expect(found).toEqual([
      ".env: an env or key file",
      "config/.env.production: an env or key file",
      "lib/key.ts: an Anthropic or OpenAI key",
      "notes.md: a GitHub token",
      "db.txt: a Neon password",
    ]);
  });

  it("leaves the example env file and tests' made-up keys alone", () => {
    expect(
      findSecrets([
        { path: ".env.example", text: "ANTHROPIC_API_KEY=" },
        { path: "vitest.config.mts", text: '"sk-ant-test-not-a-real-key"' },
        { path: "a.test.ts", text: '"sk-proj-Ab3_dEf-ghIjkLmnOpqrStuv12"' },
      ]),
    ).toEqual([]);
  });
});

describe("cloneUrl", () => {
  it("turns a GitHub remote into the https clone URL", () => {
    expect(cloneUrl("git@github.com:someone/job-agent.git")).toBe(
      "https://github.com/someone/job-agent.git",
    );
    expect(cloneUrl("https://github.com/someone/job-agent")).toBe(
      "https://github.com/someone/job-agent.git",
    );
    expect(cloneUrl("https://token@github.com/someone/job-agent.git")).toBe(
      "https://github.com/someone/job-agent.git",
    );
    expect(cloneUrl("http://127.0.0.1:8080/git/someone/job-agent")).toBeNull();
  });
});
