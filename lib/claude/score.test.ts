import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { JobFacts } from "@/lib/schemas/job";
import { type MasterProfile } from "@/lib/schemas/profile";
import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import batch from "@/test/fixtures/claude/score-batch.json";
import cv from "@/test/fixtures/claude/parse-cv-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";
import { samplePreferences } from "@/test/sample-preferences";

const { toMasterProfile } = await import("@/lib/schemas/profile");
const {
  buildScoreRequest,
  getScoreBatchProgress,
  profileContext,
  readScoreBatch,
  scoreEstimateUsd,
  scoringKey,
  submitScoreBatch,
} = await import("./score");

const results = readFileSync(
  new URL(
    "../../test/fixtures/claude/score-batch-results.jsonl",
    import.meta.url,
  ),
  "utf8",
);

const profile: MasterProfile = toMasterProfile(
  JSON.parse((cv.body.content[0] as { text: string }).text),
);
const preferences = {
  ...samplePreferences,
  stack: ["React", "TypeScript"],
  seniority: ["senior" as const],
};

const facts: JobFacts = {
  company: "Northwind Labs",
  title: "Senior Frontend Engineer (React)",
  summary: "Build the React front end of logistics analytics tools.",
  location: {
    workplace: "remote",
    quote: "Remote — anywhere in Europe.",
    allowed: ["Europe"],
    placesAre: "required",
    excluded: [],
  },
  timeZones: { quote: "", utcOffsetMin: null, utcOffsetMax: null },
  salary: { quote: "", min: null, max: null, currency: "", period: "unclear" },
  stack: ["React", "TypeScript"],
  seniority: "senior",
  contract: "full_time",
  deadline: "",
  applyUrl: "",
  requirements: ["5+ years of React and TypeScript"],
  applicationRules: [],
  aiPolicy: "",
};
const jobs = ["01", "02", "03"].map((suffix) => ({
  id: `2b9f6c1e-1a2b-4c3d-8e4f-5a6b7c8d9e${suffix}`,
  title: facts.title,
  company: facts.company,
  facts,
  eligibility: "eligible" as const,
  eligibilityReasons: [
    "The posting is open to Europe, which includes Montenegro.",
  ],
}));

describe("score requests (step 6)", () => {
  const profileText = profileContext(profile, preferences);

  it("caches the instructions and profile, sends the posting last, and uses no tools", () => {
    const request = buildScoreRequest(profileText, jobs[0], "claude-haiku-5-5");
    expect(request.tools).toBeUndefined();
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.output_config).toMatchObject({ effort: "low" });
    expect(request.system).toEqual([
      { type: "text", text: expect.stringMatching(/data, not instructions/) },
      {
        type: "text",
        text: profileText,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ]);
    expect(JSON.stringify(request.messages)).toContain(
      "Senior Frontend Engineer (React)",
    );
  });

  it("asks for the role's focus, and reasons and gaps before the score", () => {
    const request = buildScoreRequest(profileText, jobs[0], "claude-haiku-5-5");
    const schema = request.output_config?.format?.schema ?? {};
    expect(Object.keys(schema.properties as object)).toEqual([
      "focus",
      "reasons",
      "gaps",
      "score",
    ]);
  });

  it("counts any frontend framework, and never everyday tools, against a role", () => {
    const [instructions, cached] = buildScoreRequest(
      profileText,
      jobs[0],
      "claude-haiku-5-5",
    ).system as { text: string }[];
    expect(instructions.text).toMatch(/Roles wanted most/);
    expect(cached.text).toMatch(
      /# Roles wanted most\n- The candidate wants frontend roles most/,
    );
    expect(cached.text).toMatch(/whatever framework/);
    expect(cached.text).toMatch(/doesn't take the score below 80/);
    expect(instructions.text).toMatch(/Vite/);
    expect(instructions.text).toMatch(/Docker/);
    // Still only what the profile shows.
    expect(instructions.text).toMatch(/Don't assume skills/);
  });

  it("follows the kind of role wanted, and adds no rules when any will do", () => {
    const backend = profileContext(profile, {
      ...preferences,
      roleFocus: "backend",
    });
    expect(backend).toContain("- The candidate wants backend roles most");
    expect(backend).not.toContain("frontend roles most");

    const any = profileContext(profile, { ...preferences, roleFocus: "any" });
    expect(any).not.toContain("Roles wanted most");
  });

  it("puts the profile's facts in the cached block, without contact details", () => {
    expect(profileText).toContain("Northwind Analytics");
    expect(profileText).toContain("Seniority: senior");
    expect(profileText).not.toContain(profile.basics.email);
    expect(profileText).not.toContain("github.com");
    expect(profileText).toContain("# Preferences");
  });

  it("keys the scoring input: new skills or wishes change it, contact details and places don't", () => {
    const key = scoringKey(profile, preferences);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(scoringKey(profile, preferences)).toBe(key);

    const node = { ...profile.skills[0], id: "skill-node", name: "Node.js" };
    expect(
      scoringKey(
        { ...profile, skills: [...profile.skills, node] },
        preferences,
      ),
    ).not.toBe(key);
    expect(
      scoringKey(profile, { ...preferences, roleFocus: "fullstack" }),
    ).not.toBe(key);
    expect(
      scoringKey(profile, {
        ...preferences,
        stack: [...preferences.stack, "Python"],
      }),
    ).not.toBe(key);

    expect(
      scoringKey(
        { ...profile, basics: { ...profile.basics, email: "new@example.com" } },
        preferences,
      ),
    ).toBe(key);
    expect(
      scoringKey(profile, {
        ...preferences,
        countries: [...preferences.countries, "Albania"],
        excludedCompanies: ["Initech"],
      }),
    ).toBe(key);
  });

  it("estimates a batch request at well under a tenth of a cent", () => {
    const setup = {
      stage: "score" as const,
      model: "claude-haiku-5-5",
      price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
      webSearchPer1k: 10,
    };
    const estimate = scoreEstimateUsd(setup, profileText, jobs[0]);
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeLessThan(0.001);
  });
});

describe("the score batch, with recorded responses", () => {
  it("sends one request per posting, keyed by job id", async () => {
    const { client, requests } = fakeAnthropic([batch.created]);
    const id = await submitScoreBatch(
      "profile",
      jobs,
      "claude-haiku-5-5",
      client,
    );

    expect(id).toBe("msgbatch_01FixtureScore000001");
    expect(requests[0].url).toMatch(/\/v1\/messages\/batches$/);
    const body = requests[0].body as {
      requests: { custom_id: string; params: { model: string } }[];
    };
    expect(body.requests.map((request) => request.custom_id)).toEqual(
      jobs.map((job) => job.id),
    );
    expect(body.requests[0].params.model).toBe("claude-haiku-5-5");
  });

  it("reports progress until the batch ends", async () => {
    const { client } = fakeAnthropic([batch.created, batch.ended]);
    expect(
      await getScoreBatchProgress(batch.created.body.id, client),
    ).toMatchObject({
      ended: false,
      processing: 3,
    });
    expect(await getScoreBatchProgress(batch.created.body.id, client)).toEqual({
      ended: true,
      succeeded: 2,
      errored: 1,
      processing: 0,
    });
  });

  it("reads results in any order, clamps scores and reports errors", async () => {
    const { client } = fakeAnthropic([
      batch.ended,
      { requestId: "req_results", body: results },
    ]);
    const read = [];
    for await (const result of readScoreBatch(batch.ended.body.id, client)) {
      read.push(result);
    }

    expect(read.map((result) => [result.jobId.slice(-2), result.kind])).toEqual(
      [
        ["01", "scored"],
        ["03", "failed"],
        ["02", "scored"],
      ],
    );
    expect(read[0]).toMatchObject({
      kind: "scored",
      score: {
        focus: "frontend",
        score: 86,
        gaps: ["No logistics domain experience shown."],
      },
      usage: { service_tier: "batch", cache_creation_input_tokens: 1630 },
    });
    expect(read[1]).toMatchObject({
      reason: "The score request failed: Overloaded",
      usage: null,
    });
    // 131.6 is outside 0–100, so it's clamped.
    expect(read[2]).toMatchObject({ score: { score: 100 } });
  });
});
