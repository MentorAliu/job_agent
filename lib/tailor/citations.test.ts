import { describe, expect, it } from "vitest";

import {
  masterProfileSchema,
  type Answers,
  type MasterProfile,
} from "@/lib/schemas/profile";
import { tailorOutputSchema, type CvContent } from "@/lib/schemas/tailor";
import profileJson from "@/test/fixtures/profile.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";

import { citedItems, MAX_CV_SKILLS, toDocuments } from "./citations";
import {
  describeTimeZone,
  factIndex,
  profileFacts,
  profileFactsText,
  STANDARD_ANSWER_IDS,
  TIME_ZONE_FACT_ID,
} from "./facts";
import { samplePreferences } from "@/test/sample-preferences";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const answers: Answers = {
  noticePeriod: "",
  workAuthorization: "",
  links: { linkedin: "", github: "", portfolio: "" },
  extra: [],
};
const facts = factIndex(profileFacts(profile, answers));
const output = tailorOutputSchema.parse(
  JSON.parse(tailored.body.content[0].text),
);
const all = ["cv", "cover_letter", "answers"] as const;

describe("profile facts", () => {
  it("gives every fact in the profile an entry, and none for contact details", () => {
    const text = profileFactsText(profile, answers);
    for (const id of facts.keys()) expect(text).toContain(`[${id}]`);
    expect(text).not.toContain(profile.basics.email);
    expect(text).not.toContain(profile.basics.phone);
    // Highlights sit under their role, and know which role they belong to.
    expect(facts.get("hl_00000006")?.entryId).toBe("role_00000005");
  });

  it("tells Claude which standard answers are missing, so it doesn't guess them", () => {
    expect(profileFactsText(profile, answers)).toMatch(
      /hasn't saved their notice period or work authorization\. Never guess/,
    );
    const filled = {
      ...answers,
      noticePeriod: "One month",
      workAuthorization: "EU work permit not needed for remote contracts",
    };
    const text = profileFactsText(profile, filled);
    expect(text).toContain(
      `[${STANDARD_ANSWER_IDS.noticePeriod}] Notice period: One month`,
    );
    expect(text).not.toMatch(/Never guess/);
  });

  it("makes the time zones in the job preferences a fact, with their offsets", () => {
    const withZones = factIndex(
      profileFacts(profile, answers, {
        ...samplePreferences,
        timeZones: ["Europe/Belgrade", "America/New_York"],
      }),
    );
    expect(withZones.get(TIME_ZONE_FACT_ID)?.text).toBe(
      "Can work in the time zones: Europe/Belgrade (Central European Time, UTC+1, or UTC+2 with daylight saving); America/New_York (Eastern Time, UTC-5, or UTC-4 with daylight saving)",
    );
    expect(facts.has(TIME_ZONE_FACT_ID)).toBe(false);
  });

  it.each([
    ["Asia/Kolkata", "Asia/Kolkata (India Standard Time, UTC+5:30)"],
    [
      "Europe/London",
      "Europe/London (Greenwich Mean Time, UTC, or UTC+1 with daylight saving)",
    ],
    // A zone with no name of its own.
    ["Etc/GMT-3", "Etc/GMT-3 (UTC+3)"],
    [
      "Australia/Sydney",
      "Australia/Sydney (Australian Eastern Time, UTC+10, or UTC+11 with daylight saving)",
    ],
  ])("describes %s as %j", (zone, expected) => {
    expect(describeTimeZone(zone)).toBe(expected);
  });
});

describe("the citation check (step 9, code)", () => {
  const [cv, letter, answerDoc] = toDocuments(output, all, profile, facts);

  it("passes every bullet that cites real profile facts from its own role", () => {
    const flagged = new Set(cv.flags.map((flag) => flag.itemId));
    for (const item of citedItems(cv.content)) {
      if (flagged.has(item.id)) continue;
      expect(item.sources.length).toBeGreaterThan(0);
      for (const id of item.sources) expect(facts.has(id)).toBe(true);
    }
    expect(letter.flags).toEqual([]);
    expect(answerDoc.flags).toEqual([]);
  });

  it("flags a planted bullet that cites an id the profile doesn't have", () => {
    expect(cv.flags).toEqual([
      {
        itemId: "role_00000009:2",
        kind: "unknown_source",
        reason: "Cites hl_99999999, which isn't in your profile.",
        text: "Built GraphQL APIs in Go for the billing service.",
      },
    ]);
  });

  it("flags text with no source, and a bullet that cites nothing from its role", () => {
    const [doc] = toDocuments(
      {
        ...output,
        cv: {
          ...output.cv,
          summary: { text: "A seasoned engineer.", sources: [] },
          experience: [
            {
              roleId: "role_00000012",
              highlights: [
                // A Northwind result placed under Pixel Forge.
                {
                  text: "Cut page load time from 4.1 s to 1.3 s.",
                  sources: ["hl_00000006"],
                },
              ],
            },
            {
              roleId: "role_99999999",
              highlights: [{ text: "Invented a role.", sources: [] }],
            },
          ],
        },
      },
      ["cv"],
      profile,
      facts,
    );
    expect(doc.flags.map(({ itemId, kind }) => ({ itemId, kind }))).toEqual([
      { itemId: "summary", kind: "no_source" },
      { itemId: "role_00000012:0", kind: "wrong_entry" },
      { itemId: "role_99999999:0", kind: "unknown_source" },
    ]);
  });

  it("keeps every role in the profile's order, and only skills the profile has", () => {
    const content = cv.content as CvContent;
    expect(content.experience.map((entry) => entry.roleId)).toEqual(
      profile.experience.map((role) => role.id),
    );
    expect(content.skillIds.length).toBeLessThanOrEqual(MAX_CV_SKILLS);
    const [withMadeUpSkill] = toDocuments(
      {
        ...output,
        cv: { ...output.cv, skillIds: ["skill_00000021", "skill_xxxxxxxx"] },
      },
      ["cv"],
      profile,
      facts,
    );
    expect((withMadeUpSkill.content as CvContent).skillIds).toEqual([
      "skill_00000021",
    ]);
    expect(withMadeUpSkill.flags.at(-1)).toMatchObject({
      itemId: "skill:skill_xxxxxxxx",
      kind: "unknown_source",
    });
  });

  it("leaves an answer the profile can't give for the owner, without flagging it", () => {
    const content = answerDoc.content;
    expect(content.kind).toBe("answers");
    if (content.kind !== "answers") return;
    expect(content.items[2]).toEqual({
      id: "a2",
      question: "What is your notice period?",
      text: "",
      sources: [],
      missing: "Your notice period. Add it to your standard answers.",
    });
  });

  it("only builds the documents asked for", () => {
    expect(
      toDocuments(output, ["cover_letter"], profile, facts).map(
        (doc) => doc.kind,
      ),
    ).toEqual(["cover_letter"]);
  });
});
