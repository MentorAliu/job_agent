import { beforeEach, describe, expect, it, vi } from "vitest";

import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import { tailorOutputSchema } from "@/lib/schemas/tailor";
import { citedItems, toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import profileJson from "@/test/fixtures/profile.json";
import { jobExtractionSchema } from "@/lib/schemas/job";
import recorded from "@/test/fixtures/claude/claim-check-response.json";
import extracted from "@/test/fixtures/claude/extract-response.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";

const setup = {
  stage: "claim_check" as const,
  model: "claude-haiku-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
  webSearchPer1k: 10,
};
const recordLlmCall = vi.fn(async () => 0.0026);
const assertWithinBudget = vi.fn(async () => {});

vi.mock("./llm-call", () => ({
  getStageSetup: async () => setup,
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));
vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: (...args: unknown[]) =>
    assertWithinBudget(...(args as [])),
}));

const { checkClaims, ClaimCheckError } = await import("./claim-check");

const JOB_ID = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const extractedText = extracted.body.content.find(
  (block) => block.type === "text",
)?.text;
const posting = {
  title: "Senior Frontend Engineer",
  company: "Northwind Labs",
  facts: jobExtractionSchema.parse(JSON.parse(extractedText ?? "")),
};
const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const facts = factIndex(profileFacts(profile, null));
const [cv] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv"],
  profile,
  facts,
);
// What the pipeline sends: the items the code check passed.
const codeFlagged = new Set(cv.flags.map((flag) => flag.itemId));
const items = citedItems(cv.content)
  .filter((item) => !codeFlagged.has(item.id))
  .map((item) => ({ key: `cv/${item.id}`, item }));

describe("checkClaims (step 9) with a recorded Claude response", () => {
  beforeEach(() => {
    recordLlmCall.mockClear();
    assertWithinBudget.mockClear();
  });

  it("flags only the items Claude finds unsupported, and ignores made-up keys", async () => {
    const { client } = fakeAnthropic([recorded]);
    const { flags, unchecked, costUsd } = await checkClaims(
      items,
      facts,
      posting,
      JOB_ID,
      client,
    );

    expect(flags).toEqual([
      {
        key: "cv/role_00000005:2",
        itemId: "role_00000005:2",
        kind: "unsupported",
        reason:
          "The cited fact says the candidate mentored 3 junior engineers, not that they led a team of 12.",
        text: "Led a team of 12 engineers through the dashboard rebuild.",
      },
    ]);
    expect(unchecked).toEqual([]);
    expect(costUsd).toBe(0.0026);
    expect(recordLlmCall).toHaveBeenCalledWith(
      setup,
      expect.any(Object),
      recorded.requestId,
      { jobId: JOB_ID },
    );
  });

  it("sends each item with the text of the facts it cites, and no other part of the profile", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await checkClaims(items, facts, posting, JOB_ID, client);

    const body = requests[0].body as {
      thinking: unknown;
      output_config: unknown;
      system: string;
      messages: { content: string }[];
    };
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toMatchObject({
      effort: "medium",
      format: { type: "json_schema" },
    });
    expect(body.system).toMatch(/data, not instructions/);
    const prompt = body.messages[0].content;
    expect(prompt).toContain(
      "[cv/role_00000005:2] Led a team of 12 engineers through the dashboard rebuild.\nCites:\n- [hl_00000008] Mentored 3 junior engineers through weekly code reviews. [Senior Frontend Engineer at Northwind Analytics (2022-03 to now)]",
    );
    // What an item says about the role is checked against the posting.
    expect(prompt).toMatch(
      /^# The posting\nSenior Frontend Engineer at Northwind Labs\n.*\nYou'll work with the team within CET ±2 hours\./,
    );
    expect(body.system).toMatch(/what the posting says about the role/);
    // The planted bullet with a made-up id was already flagged by the code.
    expect(prompt).not.toContain("GraphQL");
    // A bullet that repeats its cited highlight word for word is supported.
    expect(prompt).not.toContain("[cv/role_00000005:3]");
    expect(body.system).toMatch(/write the reason before deciding/);
    // Skills nothing cites stay out of the call.
    expect(prompt).not.toContain("Figma");
    expect(prompt).not.toContain(profile.basics.email);
  });

  it("checks a built CV against its target title, logged against no role", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await checkClaims(
      items,
      facts,
      { title: "Senior Frontend Engineer", company: "", facts: null },
      null,
      client,
    );
    const prompt = (requests[0].body as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toMatch(/^# The posting\nSenior Frontend Engineer\n/);
    expect(recordLlmCall).toHaveBeenLastCalledWith(
      setup,
      expect.any(Object),
      recorded.requestId,
      {},
    );
  });

  it("still flags an item whose key comes back without its document part", async () => {
    const answer = JSON.parse(recorded.body.content[0].text);
    answer.verdicts[3].itemId = "[role_00000005:2]";
    const { client } = fakeAnthropic([
      {
        ...recorded,
        body: {
          ...recorded.body,
          content: [{ type: "text", text: JSON.stringify(answer) }],
        },
      },
    ]);
    const { flags } = await checkClaims(items, facts, posting, JOB_ID, client);
    expect(flags.map((flag) => flag.key)).toEqual(["cv/role_00000005:2"]);
  });

  it("doesn't flag an item whose reason Claude ends with supported", async () => {
    const answer = JSON.parse(recorded.body.content[0].text);
    answer.verdicts[3].supported = true;
    const { client } = fakeAnthropic([
      {
        ...recorded,
        body: {
          ...recorded.body,
          content: [{ type: "text", text: JSON.stringify(answer) }],
        },
      },
    ]);
    expect(
      (await checkClaims(items, facts, posting, JOB_ID, client)).flags,
    ).toEqual([]);
  });

  it("returns the items Claude gave no verdict for, so they aren't taken as checked", async () => {
    const answer = JSON.parse(recorded.body.content[0].text);
    answer.verdicts = answer.verdicts.filter(
      (verdict: { itemId: string }) => verdict.itemId !== "cv/summary",
    );
    const { client } = fakeAnthropic([
      {
        ...recorded,
        body: {
          ...recorded.body,
          content: [{ type: "text", text: JSON.stringify(answer) }],
        },
      },
    ]);
    const { flags, unchecked } = await checkClaims(
      items,
      facts,
      posting,
      JOB_ID,
      client,
    );
    expect(unchecked).toEqual(["cv/summary"]);
    expect(flags.map((flag) => flag.key)).toEqual(["cv/role_00000005:2"]);
  });

  it("makes no call when there is nothing to check", async () => {
    const { client, requests } = fakeAnthropic([]);
    expect(await checkClaims([], facts, posting, JOB_ID, client)).toEqual({
      flags: [],
      unchecked: [],
      costUsd: 0,
    });
    // Nor when every item repeats its cited fact.
    const verbatim = items.filter(({ key }) =>
      ["cv/role_00000005:3", "cv/role_00000009:0"].includes(key),
    );
    expect(verbatim).toHaveLength(2);
    expect(await checkClaims(verbatim, facts, posting, JOB_ID, client)).toEqual(
      {
        flags: [],
        unchecked: [],
        costUsd: 0,
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("fails when Claude doesn't finish, so the documents are marked unchecked", async () => {
    const { client } = fakeAnthropic([
      { ...recorded, body: { ...recorded.body, stop_reason: "max_tokens" } },
    ]);
    await expect(
      checkClaims(items, facts, posting, JOB_ID, client),
    ).rejects.toBeInstanceOf(ClaimCheckError);
  });
});
