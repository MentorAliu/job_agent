import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_SEARCH_DOMAINS,
} from "@/lib/schemas/settings";
import recorded from "@/test/fixtures/claude/discover-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";

import type { CliOutcome } from "./cli/run";
import { usageFrom, type CliTask } from "./cli/task";
import { samplePreferences } from "@/test/sample-preferences";

const setupFor = (model: string) => ({
  stage: "discover" as const,
  model,
  price: DEFAULT_PRICE_TABLE.models[model],
  webSearchPer1k: 10,
});

const recordLlmCall = vi.fn(async () => 0.0302);
const getStageSetup = vi.fn(async (_stage: string, model?: string) =>
  setupFor(model ?? "claude-haiku-5-5"),
);
const assertWithinBudget = vi.fn(async () => {});

vi.mock("./llm-call", () => ({
  getStageSetup: (...args: [string, string?]) => getStageSetup(...args),
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));
const runCliTasks = vi.fn<
  (engine: string, tasks: CliTask[]) => Promise<CliOutcome[]>
>(async () => []);
vi.mock("./cli/run", () => ({
  runCliTasks: (...args: [string, CliTask[]]) => runCliTasks(...args),
}));
vi.mock("@/lib/pipeline/engine-state", () => ({
  noteEngineIssue: async () => {},
  readClaudeApiKey: async () => process.env.ANTHROPIC_API_KEY?.trim() || null,
}));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: (...args: unknown[]) =>
    assertWithinBudget(...(args as [])),
}));

const { describeCriteria, discoverPostings, searchCriteria } =
  await import("./discover");

const criteria = searchCriteria({
  ...samplePreferences,
  stack: ["React", "TypeScript"],
  seniority: ["senior"],
});
const domains = ["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com"];
const sites = { kind: "sites" as const, domains };
const openWeb = { kind: "web" as const, except: DEFAULT_SEARCH_DOMAINS };
const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

const modelInfo = (id: string, webSearch: boolean) => ({
  requestId: `req_models_${id}`,
  body: {
    id,
    type: "model",
    display_name: id,
    created_at: "2026-09-01T00:00:00Z",
    capabilities: {
      server_tools: {
        supported: true,
        web_search: { supported: webSearch },
        code_execution: { supported: true },
      },
    },
  },
});

describe("discoverPostings (step 2) with a recorded Claude response", () => {
  beforeEach(() => {
    recordLlmCall.mockClear();
    getStageSetup.mockClear();
    assertWithinBudget.mockClear();
  });

  it("takes the links from the search result blocks", async () => {
    const { client } = fakeAnthropic([
      modelInfo("claude-haiku-5-5", true),
      recorded,
    ]);
    const result = await discoverPostings(criteria, sites, RUN_ID, client);

    expect(result.urls).toEqual([
      "https://boards.greenhouse.io/northwindlabs/jobs/4012345",
      "https://jobs.lever.co/blueharbor/3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a4b?lever-source=board",
      "https://boards.greenhouse.io/northwindlabs",
      "https://jobs.ashbyhq.com/pixelforge/9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      "https://boards.greenhouse.io/northwindlabs/jobs/4012345?utm_source=search",
    ]);
    expect(result).toMatchObject({ searches: 2, costUsd: 0.0302 });
    expect(recordLlmCall).toHaveBeenCalledWith(
      setupFor("claude-haiku-5-5"),
      expect.objectContaining({ input_tokens: 9120 }),
      "req_01FixtureDiscover0000001",
      { runId: RUN_ID },
    );
  });

  it("limits web search to the domains and 3 searches, and sends no profile", async () => {
    const { client, requests } = fakeAnthropic([
      modelInfo("claude-haiku-5-5", true),
      recorded,
    ]);
    await discoverPostings(criteria, sites, RUN_ID, client);

    expect(requests[0].url).toMatch(/\/v1\/models\/claude-haiku-5-5$/);
    const body = requests[1].body as Record<string, unknown>;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "low" });
    // Caching on, so each search's results are cached for the next search.
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools).toEqual([
      {
        type: "web_search_20260318",
        name: "web_search",
        max_uses: 3,
        allowed_domains: domains,
        allowed_callers: ["direct"],
      },
    ]);
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain("React, TypeScript");
    expect(prompt).toContain("Montenegro");
    // A discover call reads the web, so it never sees the CV.
    expect(prompt).not.toMatch(/Jordan|Northwind Analytics|@/);
  });

  it("searches the open web without the job sites searched by name or the ones off limits", async () => {
    const { client, requests } = fakeAnthropic([
      modelInfo("claude-haiku-5-5", true),
      recorded,
    ]);
    const result = await discoverPostings(criteria, openWeb, RUN_ID, client);
    expect(result.searches).toBe(2);

    const body = requests[1].body as {
      tools: Record<string, unknown>[];
      messages: unknown[];
      cache_control?: unknown;
    };
    // Cached like the job-site calls, so later searches reuse earlier results.
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools).toHaveLength(1);
    const [search] = body.tools;
    expect(search).toMatchObject({
      type: "web_search_20260318",
      max_uses: 3,
      allowed_callers: ["direct"],
    });
    // The API takes one filter or the other, never both.
    expect(search).not.toHaveProperty("allowed_domains");
    const blocked = search.blocked_domains as string[];
    expect(blocked).toEqual(expect.arrayContaining(DEFAULT_SEARCH_DOMAINS));
    expect(blocked).toEqual(
      expect.arrayContaining(["linkedin.com", "indeed.com", "glassdoor.com"]),
    );
    expect(new Set(blocked).size).toBe(blocked.length);
    for (const domain of blocked) {
      expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }

    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain("careers pages");
    expect(prompt).toContain('Put \\"remote\\" in every query.');
    expect(prompt).not.toMatch(/Jordan|Northwind Analytics|@/);
  });

  it("checks the budget before the call, with the run's id", async () => {
    const { client } = fakeAnthropic([
      modelInfo("claude-haiku-5-5", true),
      recorded,
    ]);
    await discoverPostings(criteria, sites, RUN_ID, client);
    expect(assertWithinBudget).toHaveBeenCalledWith(expect.any(Number), RUN_ID);
    const [[estimate]] = assertWithinBudget.mock.calls as unknown as [[number]];
    // 3 searches at $10 per 1,000, plus tokens.
    expect(estimate).toBeGreaterThan(0.03);
    expect(estimate).toBeLessThan(0.04);
  });

  it("falls back to Sonnet 5.5 when the model can't search", async () => {
    const { client, requests } = fakeAnthropic([
      modelInfo("claude-haiku-4-5", false),
      recorded,
    ]);
    getStageSetup.mockImplementationOnce(async () => ({
      ...setupFor("claude-haiku-5-5"),
      model: "claude-haiku-4-5",
    }));
    await discoverPostings(criteria, sites, RUN_ID, client);

    expect(getStageSetup).toHaveBeenLastCalledWith(
      "discover",
      "claude-sonnet-5-5",
    );
    const body = requests[1].body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.thinking).toEqual({ type: "between_tools" });
  });
});

describe("discoverPostings on a command-line agent", () => {
  beforeEach(() => {
    getStageSetup.mockImplementationOnce(async () => ({
      ...setupFor("claude-haiku-5-5"),
      engine: "claude_code",
    }));
    recordLlmCall.mockClear();
    assertWithinBudget.mockClear();
  });

  it("asks the agent to keep to the sites, and takes its links with no API call", async () => {
    runCliTasks.mockResolvedValueOnce([
      {
        ok: true,
        reply: {
          output: {
            urls: ["https://boards.greenhouse.io/northwind/jobs/1001"],
          },
          usage: usageFrom({ inputTokens: 20_000, outputTokens: 900 }),
          model: "claude-haiku-5-5",
          requestId: "session-1",
          webSearches: 3,
        },
      },
    ]);
    const { client, requests } = fakeAnthropic([]);
    const result = await discoverPostings(criteria, sites, RUN_ID, client);

    expect(requests).toHaveLength(0);
    expect(assertWithinBudget).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      urls: ["https://boards.greenhouse.io/northwind/jobs/1001"],
      searches: 3,
    });
    const [[engine, [task]]] = runCliTasks.mock.calls.slice(-1);
    expect(engine).toBe("claude_code");
    expect(task.webSearches).toBe(3);
    expect(task.prompt).toContain(
      "Search only these job sites, with site: in every query: greenhouse.io, lever.co, ashbyhq.com, workable.com",
    );
    expect(task.allowedDomains).toEqual([
      "greenhouse.io",
      "lever.co",
      "ashbyhq.com",
      "workable.com",
    ]);
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "session-1",
      { runId: RUN_ID, engine: "claude_code" },
    );
  });

  it("names the sites to keep off on the open web", async () => {
    runCliTasks.mockResolvedValueOnce([
      {
        ok: true,
        reply: {
          output: { urls: [] },
          usage: usageFrom({ inputTokens: 1, outputTokens: 1 }),
          model: "claude-haiku-5-5",
          requestId: null,
          webSearches: 1,
        },
      },
    ]);
    await discoverPostings(criteria, openWeb, RUN_ID, fakeAnthropic([]).client);
    const [[, [task]]] = runCliTasks.mock.calls.slice(-1);
    expect(task.prompt).toMatch(
      /Don't search these sites: .*greenhouse\.io.*linkedin\.com/,
    );
  });
});

describe("describeCriteria", () => {
  it("asks for fully remote roles in every query when the owner wants remote only", () => {
    expect(describeCriteria(criteria)).toContain(
      '- Fully remote roles only, never hybrid or on-site. Put "remote" in every query.',
    );
    expect(describeCriteria({ ...criteria, remoteOnly: false })).toContain(
      "- Remote roles preferred",
    );
  });

  it("asks for the kind of role wanted first, or for none when any will do", () => {
    expect(describeCriteria(criteria)).toContain(
      "- Frontend roles first, in any framework",
    );
    expect(describeCriteria({ ...criteria, roleFocus: "backend" })).toContain(
      "- Backend roles first, in any language",
    );
    expect(describeCriteria({ ...criteria, roleFocus: "any" })).not.toMatch(
      /roles first/,
    );
  });

  it("aims the open-web queries at employers' own careers pages", () => {
    expect(describeCriteria(criteria)).not.toContain("careers pages");
    expect(describeCriteria(criteria, "web")).toContain(
      "employers' own careers pages",
    );
  });
});
