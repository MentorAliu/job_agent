import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkEligibility } from "@/lib/jobs/eligibility";
import { ownerClock } from "@/lib/jobs/today";
import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import recorded from "@/test/fixtures/claude/extract-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";
import type { Fetched } from "@/lib/jobs/public-fetch";

import type { CliOutcome } from "./cli/run";
import { usageFrom, type CliTask } from "./cli/task";
import { samplePreferences } from "@/test/sample-preferences";

const setup = {
  stage: "extract" as const,
  model: "claude-haiku-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
  webSearchPer1k: 10,
};
const recordLlmCall = vi.fn(async () => 0.000542);
const assertWithinBudget = vi.fn(async () => {});

const engine = vi.hoisted(() => ({ picked: undefined as string | undefined }));
vi.mock("./llm-call", () => ({
  getStageSetup: async () =>
    engine.picked ? { ...setup, engine: engine.picked } : setup,
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));
const fetchPublic = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<Fetched>>(async () => ({ ok: false })),
);
vi.mock("@/lib/jobs/public-fetch", () => ({ fetchPublic }));
const runCliTasks = vi.hoisted(() =>
  vi.fn<(engine: string, tasks: CliTask[]) => Promise<CliOutcome[]>>(
    async () => [],
  ),
);
vi.mock("./cli/run", () => ({ runCliTasks }));
const noteEngineIssue = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/pipeline/engine-state", () => ({
  noteEngineIssue,
  readClaudeApiKey: async () => process.env.ANTHROPIC_API_KEY?.trim() || null,
}));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: (...args: unknown[]) =>
    assertWithinBudget(...(args as [])),
}));

const { readPosting, siteDomain } = await import("./extract");

const URL = "https://boards.greenhouse.io/northwindlabs/jobs/4012345";
const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";
const CLOCK = ownerClock("Europe/Belgrade");

/** The recorded response with its content blocks replaced. */
function withContent(content: unknown[], stopReason = "end_turn") {
  return {
    ...recorded,
    body: { ...recorded.body, content, stop_reason: stopReason },
  };
}

describe("readPosting (step 4) with a recorded Claude response", () => {
  beforeEach(() => {
    recordLlmCall.mockClear();
    assertWithinBudget.mockClear();
  });

  it("reads the posting's facts and keeps the fetched page", async () => {
    const { client } = fakeAnthropic([recorded]);
    const result = await readPosting(URL, RUN_ID, CLOCK, client);

    expect(result.kind).toBe("posting");
    if (result.kind !== "posting") return;
    expect(result.facts).toMatchObject({
      company: "Northwind Labs",
      title: "Senior Frontend Engineer (React)",
      location: { workplace: "remote", allowed: ["Europe"] },
      timeZones: { utcOffsetMin: -1, utcOffsetMax: 3 },
      salary: { min: 65000, max: 80000, currency: "EUR" },
      aiPolicy: "Please don't use AI tools to write your answers.",
    });
    expect(result.facts).not.toHaveProperty("isJobPosting");
    expect(result.facts).not.toHaveProperty("posted");
    // The page doesn't say when it was posted.
    expect(result.postedOn).toBeNull();
    expect(result.pageText).toContain("anywhere in Europe");
    expect(result.costUsd).toBe(0.000542);

    // The quotes are in the page, so the eligibility check trusts them.
    const verdict = checkEligibility(
      result.facts,
      samplePreferences,
      result.pageText ?? undefined,
    );
    expect(verdict.eligibility).toBe("eligible");
    expect(verdict.quote).toBe("Location: Remote — anywhere in Europe.");
  });

  it("fetches one page on the posting's own site, with structured output and no profile", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await readPosting(URL, RUN_ID, CLOCK, client);

    const body = requests[0].body as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        type: "web_fetch_20260318",
        name: "web_fetch",
        max_uses: 1,
        max_content_tokens: 12000,
        allowed_domains: ["greenhouse.io"],
        allowed_callers: ["direct"],
      },
    ]);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toMatchObject({
      effort: "low",
      format: { type: "json_schema" },
    });
    // Today's date, for working out "Posted 3 days ago".
    expect(JSON.stringify(body.messages)).toBe(
      JSON.stringify([
        {
          role: "user",
          content: `Read the job posting at ${URL} into the schema. Today is ${CLOCK.today}.`,
        },
      ]),
    );
    expect(body.system).toMatch(/data, not instructions/);
    expect(assertWithinBudget).toHaveBeenCalledWith(expect.any(Number), RUN_ID);
  });

  it("skips a page the fetch couldn't read, and still logs the call", async () => {
    const { client } = fakeAnthropic([
      withContent([
        recorded.body.content[0],
        {
          type: "web_fetch_tool_result",
          tool_use_id: "srvtoolu_01FixtureFetchA",
          caller: { type: "direct" },
          content: {
            type: "web_fetch_tool_result_error",
            error_code: "url_not_accessible",
          },
        },
        { type: "text", text: "I couldn't read the page.", citations: null },
      ]),
    ]);
    const result = await readPosting(URL, RUN_ID, CLOCK, client);

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "The page couldn't be read (url_not_accessible).",
      // The page may be back next time.
      final: false,
    });
    expect(recordLlmCall).toHaveBeenCalledTimes(1);
  });

  it("skips a page that isn't an open posting", async () => {
    const answer = JSON.parse(recorded.body.content[2].text as string);
    const { client } = fakeAnthropic([
      withContent([
        recorded.body.content[0],
        recorded.body.content[1],
        {
          type: "text",
          text: JSON.stringify({ ...answer, isJobPosting: false }),
          citations: null,
        },
      ]),
    ]);
    expect(await readPosting(URL, RUN_ID, CLOCK, client)).toMatchObject({
      kind: "skipped",
      reason: "The page isn't an open job posting.",
      final: true,
    });
  });

  it("keeps the day the page says it was posted, when its words are on the page", async () => {
    const answer = JSON.parse(recorded.body.content[2].text as string);
    // The recorded fetch result, with the page saying when it was posted.
    const page = structuredClone(recorded.body.content[1]) as {
      content: { content: { source: { data: string } } };
    };
    page.content.content.source.data += "\n\nPosted 5 days ago";
    const read = async (posted: { quote: string; date: string }) => {
      const { client } = fakeAnthropic([
        withContent([
          recorded.body.content[0],
          page,
          {
            type: "text",
            text: JSON.stringify({ ...answer, posted }),
            citations: null,
          },
        ]),
      ]);
      const result = await readPosting(URL, RUN_ID, CLOCK, client);
      return result.kind === "posting" ? result.postedOn : "skipped";
    };

    expect(await read({ quote: "Posted 5 days ago", date: "2026-10-13" })).toBe(
      "2026-10-13",
    );
    // A day worked out from words the page doesn't have, or a bad day.
    expect(
      await read({ quote: "Posted yesterday", date: "2026-10-17" }),
    ).toBeNull();
    expect(
      await read({ quote: "Posted 5 days ago", date: "13 October" }),
    ).toBeNull();
    expect(await read({ quote: "", date: "" })).toBeNull();
  });

  it("continues a paused turn once", async () => {
    const paused = withContent(recorded.body.content.slice(0, 2), "pause_turn");
    const resumed = withContent([recorded.body.content[2]]);
    const { client, requests } = fakeAnthropic([paused, resumed]);
    const result = await readPosting(URL, RUN_ID, CLOCK, client);

    expect(result.kind).toBe("posting");
    expect(requests).toHaveLength(2);
    const second = requests[1].body as { messages: { role: string }[] };
    expect(second.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(recordLlmCall).toHaveBeenCalledTimes(2);
  });
});

describe("readPosting on a command-line agent", () => {
  const extraction: unknown = JSON.parse(
    recorded.body.content.findLast((block) => block.type === "text")?.text ??
      "",
  );
  const page = `<html><body><h1>Senior Frontend Engineer (React)</h1><p>Northwind Labs</p><p>Location: Remote — anywhere in Europe.</p>${"<p>You build the React front end of our analytics tools.</p>".repeat(10)}</body></html>`;

  beforeEach(() => {
    engine.picked = "claude_code";
    recordLlmCall.mockClear();
    noteEngineIssue.mockClear();
    runCliTasks.mockReset();
  });
  afterEach(() => {
    engine.picked = undefined;
  });

  it("reads the page the app fetched, with no API call", async () => {
    fetchPublic.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: URL,
      redirected: false,
      text: page,
    });
    runCliTasks.mockResolvedValueOnce([
      {
        ok: true,
        reply: {
          output: extraction,
          usage: usageFrom({ inputTokens: 3000, outputTokens: 400 }),
          model: "claude-haiku-5-5",
          requestId: "session-1",
          webSearches: 0,
        },
      },
    ]);
    const { client, requests } = fakeAnthropic([]);
    const result = await readPosting(URL, RUN_ID, CLOCK, client);

    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({
      kind: "posting",
      facts: { company: "Northwind Labs" },
    });
    const [[, [task]]] = runCliTasks.mock.calls;
    expect(task.webSearches).toBeUndefined();
    expect(task.prompt).toContain("Location: Remote — anywhere in Europe.");
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "session-1",
      { runId: RUN_ID, engine: "claude_code" },
    );
  });

  it("reads a page the app can't fetch on the API, and says why", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    const result = await readPosting(URL, RUN_ID, CLOCK, client);

    expect(runCliTasks).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(result.kind).toBe("posting");
    expect(noteEngineIssue).toHaveBeenCalledWith(
      "claude_code",
      expect.stringContaining("boards.greenhouse.io"),
    );
  });
});

describe("siteDomain", () => {
  it("keeps the registrable part of the host", () => {
    expect(siteDomain("https://boards.greenhouse.io/a/jobs/1")).toBe(
      "greenhouse.io",
    );
    expect(siteDomain("https://careers.acme.co.uk/jobs/1")).toBe("acme.co.uk");
    expect(siteDomain("https://remotive.com/remote-jobs/x")).toBe(
      "remotive.com",
    );
  });
});
