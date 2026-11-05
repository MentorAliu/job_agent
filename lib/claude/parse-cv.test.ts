import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_TABLE } from "@/lib/schemas/settings";
import { factIds, masterProfileSchema } from "@/lib/schemas/profile";
import recorded from "@/test/fixtures/claude/parse-cv-response.json";
import { fakeAnthropic } from "@/test/fake-anthropic";

const recordLlmCall = vi.fn(async () => 0.027294);
const setup = {
  stage: "parse_cv" as const,
  model: "claude-sonnet-5-5",
  price: DEFAULT_PRICE_TABLE.models["claude-sonnet-5-5"],
  webSearchPer1k: 10,
};

vi.mock("./budget", async () => ({
  ...(await vi.importActual<object>("./budget")),
  assertWithinBudget: async () => {},
  estimateUsd: () => 0.2,
}));
vi.mock("./llm-call", () => ({
  getStageSetup: async () => setup,
  recordLlmCall: (...args: unknown[]) => recordLlmCall(...(args as [])),
}));

const { CvParseError, readCv } = await import("./parse-cv");

describe("readCv (step 1) with a recorded Claude response", () => {
  beforeEach(() => recordLlmCall.mockClear());

  it("turns the response into a master profile with every role, project and skill", async () => {
    const { client } = fakeAnthropic([recorded]);
    const { profile, costUsd } = await readCv(
      { kind: "pdf", anthropicFileId: "file_011CV" },
      client,
    );

    expect(profile.basics.name).toBe("Jordan Sample");
    expect(profile.experience.map((role) => role.company)).toEqual([
      "Northwind Analytics",
      "Blue Harbor Software",
      "Pixel Forge",
    ]);
    expect(profile.projects.map((project) => project.name)).toEqual([
      "Open Timetable",
      "Budget Buddy",
    ]);
    expect(profile.skills).toHaveLength(14);
    expect(profile.experience[0]).toMatchObject({ current: true, endDate: "" });
    expect(profile.links[0].url).toBe("https://github.com/jordansample");
    expect(costUsd).toBe(0.027294);

    // Every fact has a unique id, and the draft passes the form's own schema.
    const ids = factIds(profile);
    expect(new Set(ids).size).toBe(ids.length);
    expect(masterProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("sends the CV as a Files API document, with structured output and no tools", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await readCv({ kind: "pdf", anthropicFileId: "file_011CV" }, client);

    expect(requests).toHaveLength(1);
    const body = requests[0].body as Record<string, unknown>;
    expect(requests[0].url).toMatch(/\/v1\/messages$/);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tools).toBeUndefined();
    // Sonnet 5.5 rejects { type: "disabled" }; between_tools is its "off".
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.output_config).toMatchObject({
      effort: "low",
      format: { type: "json_schema" },
    });
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "document",
            title: "CV",
            source: { type: "file", file_id: "file_011CV" },
          },
          { type: "text", text: "Read this CV into the schema." },
        ],
      },
    ]);
  });

  it("sends DOCX text as a plain-text document", async () => {
    const { client, requests } = fakeAnthropic([recorded]);
    await readCv({ kind: "text", text: "Jordan Sample\nEngineer" }, client);

    const body = requests[0].body as {
      messages: { content: { source?: unknown }[] }[];
    };
    expect(body.messages[0].content[0].source).toEqual({
      type: "text",
      media_type: "text/plain",
      data: "Jordan Sample\nEngineer",
    });
  });

  it("logs the call with its usage and request id", async () => {
    const { client } = fakeAnthropic([recorded]);
    await readCv({ kind: "pdf", anthropicFileId: "file_011CV" }, client);

    expect(recordLlmCall).toHaveBeenCalledWith(
      setup,
      expect.objectContaining({ input_tokens: 4182, output_tokens: 1893 }),
      "req_01FixtureParseCv000000001",
    );
  });

  it("still logs the call when the output was cut off, then fails", async () => {
    const truncated = {
      ...recorded,
      body: {
        ...recorded.body,
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"basics":{"name":"Jor' }],
      },
    };
    const { client } = fakeAnthropic([truncated]);

    await expect(
      readCv({ kind: "pdf", anthropicFileId: "file_011CV" }, client),
    ).rejects.toBeInstanceOf(CvParseError);
    expect(recordLlmCall).toHaveBeenCalledTimes(1);
  });
});
