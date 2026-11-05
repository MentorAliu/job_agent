import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { jobExtractionSchema } from "@/lib/schemas/job";
import extracted from "@/test/fixtures/claude/extract-response.json";

import { buildDiscoverRequest } from "../discover";
import { buildParseCvRequest } from "../parse-cv";
import { buildScoreRequest } from "../score";
import { shellWord, taskFromRequest, usageFrom } from "./task";

const criteria = {
  remoteOnly: true,
  countries: ["Montenegro"],
  timeZones: ["Europe/Belgrade"],
  seniority: ["senior" as const],
  stack: ["React"],
  roleFocus: "frontend" as const,
};

describe("taskFromRequest", () => {
  it("turns a one-shot request into the same instructions, prompt and schema", () => {
    const request = buildParseCvRequest(
      { kind: "text", text: "Jordan Sample, Senior Frontend Engineer" },
      "claude-sonnet-5-5",
    );
    const task = taskFromRequest(request, "parse_cv");
    expect(task).toMatchObject({
      stage: "parse_cv",
      model: "claude-sonnet-5-5",
      system: request.system,
      effort: "low",
    });
    expect(task?.prompt).toBe(
      '<document title="CV">\nJordan Sample, Senior Frontend Engineer\n</document>\n\nRead this CV into the schema.',
    );
    expect(task?.schema).toEqual(
      (request.output_config?.format as { schema: unknown }).schema,
    );
    expect(task?.webSearches).toBeUndefined();
  });

  it("joins the system blocks, as the score step's cached profile", () => {
    const request = buildScoreRequest(
      "# Candidate profile",
      {
        id: "j1",
        title: "Frontend Engineer",
        company: "Northwind",
        facts: jobExtractionSchema.parse(
          JSON.parse(
            extracted.body.content.find((block) => block.type === "text")
              ?.text ?? "",
          ),
        ),
        eligibility: "eligible",
        eligibilityReasons: [],
      },
      "claude-haiku-5-5",
    );
    expect(taskFromRequest(request, "score")?.system).toMatch(
      /# Candidate profile$/,
    );
  });

  it("refuses what an agent can't take as it is", () => {
    expect(
      taskFromRequest(
        buildParseCvRequest(
          { kind: "pdf", anthropicFileId: "file_1" },
          "claude-sonnet-5-5",
        ),
        "parse_cv",
      ),
    ).toBeNull();
    expect(
      taskFromRequest(
        buildDiscoverRequest(
          criteria,
          { kind: "sites", domains: ["lever.co"] },
          "claude-haiku-5-5",
        ),
        "discover",
      ),
    ).toBeNull();
  });
});

describe("usageFrom", () => {
  it("fills every field the logging reads", () => {
    expect(
      usageFrom({ inputTokens: 10, outputTokens: 5, webSearches: 2 }),
    ).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
    });
  });
});

describe("shellWord", () => {
  it.each([
    "/tmp/job-agent-abc/prompt.txt",
    String.raw`C:\Users\Ana Kelmendi\AppData\Local\Temp\job-agent-x/prompt.txt`,
    "/home/o'brien/$HOME `x`/prompt.txt",
  ])("keeps %s as one word for bash", (path) => {
    const said = execFileSync("bash", ["-c", `printf %s ${shellWord(path)}`], {
      encoding: "utf8",
    });
    expect(said).toBe(path);
  });
});
