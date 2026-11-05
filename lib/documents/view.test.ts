import { describe, expect, it } from "vitest";

import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import {
  tailorOutputSchema,
  type ClaimCheck,
  type CoverLetterContent,
  type CvContent,
} from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import profileJson from "@/test/fixtures/profile.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";

import {
  answersView,
  cvDiff,
  cvView,
  documentText,
  formatDateRange,
  groupSkills,
  letterText,
  letterView,
} from "./view";
import { wordDiff } from "./word-diff";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const facts = factIndex(profileFacts(profile, null));
const [cv, letter, answers] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv", "cover_letter", "answers"],
  profile,
  facts,
);
const cvContent = cv.content as CvContent;
// The code check's flag, plus the one Claude's check adds (the recorded
// claim check response).
const check: ClaimCheck = {
  flags: [
    ...cv.flags,
    {
      itemId: "role_00000005:2",
      kind: "unsupported",
      reason: "The cited fact says the candidate mentored 3 junior engineers.",
      text: "Led a team of 12 engineers through the dashboard rebuild.",
    },
  ],
  checkedAt: "2026-10-18T10:00:00.000Z",
  checkError: null,
};

describe("formatDateRange", () => {
  it.each([
    ["2022-03", "", true, "Mar 2022 – Present"],
    ["2018-06", "2022-02", false, "Jun 2018 – Feb 2022"],
    ["2016", "2018", false, "2016 – 2018"],
    ["", "2019", false, "2019"],
    ["2020-01", "2020-01", false, "Jan 2020"],
    ["", "", false, ""],
  ])("%s to %s (current: %s) is %j", (start, end, current, expected) => {
    expect(formatDateRange(start, end, current)).toBe(expected);
  });
});

describe("wordDiff", () => {
  it("marks the words added and removed", () => {
    expect(
      wordDiff(
        "Cut page load time from 4.1 s to 1.3 s.",
        "Rebuilt the dashboard, cutting page load time from 4.1 s to 1.3 s.",
      ),
    ).toEqual([
      { kind: "removed", text: "Cut" },
      { kind: "added", text: "Rebuilt the dashboard, cutting" },
      { kind: "same", text: "page load time from 4.1 s to 1.3 s." },
    ]);
  });

  it("returns one same part for identical text, and nothing for two empty ones", () => {
    expect(wordDiff("a  b c", "a b c")).toEqual([
      { kind: "same", text: "a b c" },
    ]);
    expect(wordDiff("", "")).toEqual([]);
  });
});

describe("the tailored CV as sent", () => {
  const view = cvView(cvContent, check, profile);

  it("leaves out both planted claims, the code's flag and Claude's", () => {
    const text = JSON.stringify(view);
    expect(text).not.toContain("GraphQL");
    expect(text).not.toContain("team of 12");
    expect(view.experience[0].highlights).toEqual([
      "Rebuilt the reporting dashboard in Next.js, cutting page load time from 4.1 s to 1.3 s.",
      "Introduced a shared React component library used by 4 product teams.",
      "Mentored 3 junior engineers through weekly code reviews.",
    ]);
  });

  it("takes names, titles and dates from the profile, not from Claude", () => {
    expect(view.name).toBe(profile.basics.name);
    expect(view.experience.map((role) => role.company)).toEqual(
      profile.experience.map((role) => role.company),
    );
    expect(view.experience[0].dates).toMatch(/– Present$/);
    expect(view.skills.slice(0, 3)).toEqual(["React", "TypeScript", "Next.js"]);
    expect(view.education).toHaveLength(profile.education.length);
  });

  it("keeps flagged text when there is no check yet, as Claude wrote it", () => {
    expect(
      JSON.stringify(cvView(cvContent, null, profile).experience),
    ).toContain("team of 12");
  });
});

describe("groupSkills", () => {
  it("groups skills under their categories in list order, with Other last", () => {
    expect(
      groupSkills([
        { name: "React", category: "Frameworks" },
        { name: "Claude Code", category: "" },
        { name: "TypeScript", category: "Languages" },
        { name: "Next.js", category: "Frameworks" },
        { name: "Figma", category: " " },
      ]),
    ).toEqual([
      { category: "Frameworks", names: ["React", "Next.js"] },
      { category: "Languages", names: ["TypeScript"] },
      { category: "Other", names: ["Claude Code", "Figma"] },
    ]);
  });

  it("puts the tailored CV's skills in the profile's categories", () => {
    const view = cvView(cvContent, check, profile);
    expect(view.skillGroups[0]).toEqual({
      category: "Frameworks",
      names: ["React", "Next.js"],
    });
    expect(view.skillGroups.flatMap((group) => group.names).sort()).toEqual(
      [...view.skills].sort(),
    );
    expect(view.experience[0].technologies).toEqual(
      profile.experience[0].technologies,
    );
  });
});

describe("the cover letter and answers", () => {
  it("adds the greeting and sign-off, and leaves flagged paragraphs out of the copy text", () => {
    const content = letter.content as CoverLetterContent;
    const flagged: ClaimCheck = {
      flags: [
        {
          itemId: "p3",
          kind: "unsupported",
          reason: "Not in the profile.",
          text: content.paragraphs[3].text,
        },
      ],
      checkedAt: null,
      checkError: null,
    };
    const view = letterView(content, flagged, profile, "Northwind Labs");
    expect(view.paragraphs).toHaveLength(3);
    const text = letterText(view);
    expect(text).toMatch(/^Dear Northwind Labs hiring team,\n\n/);
    expect(text).toMatch(/\n\nKind regards,\nJordan Sample$/);
    expect(text).not.toContain(content.paragraphs[3].text);
  });

  it("shows what the owner has to add for an answer the profile can't give", () => {
    const items = answersView(
      answers.content as Parameters<typeof answersView>[0],
      null,
    );
    expect(items[2]).toEqual({
      id: "a2",
      question: "What is your notice period?",
      answer: "",
      missing: "Your notice period. Add it to your standard answers.",
      flag: null,
      fromStandard: false,
    });
  });

  it("marks an answer that cites the owner's standard answers", () => {
    const content = answers.content as Parameters<typeof answersView>[0];
    const items = answersView(
      {
        ...content,
        items: [
          { ...content.items[0], sources: ["std_noticepd"] },
          { ...content.items[1], sources: ["qa_salary01", "role_00000005"] },
          { ...content.items[2], sources: ["role_00000005"] },
        ],
      },
      null,
    );
    expect(items.map((item) => item.fromStandard)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("the tailored CV against the master CV", () => {
  const diff = cvDiff(cvContent, check, profile);

  it("shows each bullet with the fact it rewords, and its word changes", () => {
    const northwind = diff.entries[0];
    expect(northwind.title).toBe(
      `${profile.experience[0].title}, ${profile.experience[0].company}`,
    );
    const [first] = northwind.bullets;
    expect(first.from).toEqual([
      { id: "hl_00000006", text: profile.experience[0].highlights[0].text },
    ]);
    expect(first.changes?.some((part) => part.kind === "same")).toBe(true);
    expect(first.flag).toBeNull();
  });

  it("marks flagged bullets, and lists what the tailored CV leaves out", () => {
    expect(diff.entries[0].bullets[2].flag?.kind).toBe("unsupported");
    expect(diff.entries[1].bullets[2].flag?.kind).toBe("unknown_source");
    // Pixel Forge has no tailored bullets, so its master bullet is left out.
    expect(diff.entries[2].leftOut).toEqual(
      profile.experience[2].highlights.map((highlight) => highlight.text),
    );
    expect(diff.skills.leftOut).toContain("Figma");
    expect(diff.skills.shown).not.toContain("Figma");
  });

  it("writes the CV as text for a regenerate request, leaving flagged claims out", () => {
    const text = documentText(cvContent, check, profile);
    expect(text).toMatch(/^Summary: Senior frontend engineer/);
    expect(text).toContain("- Mentored 3 junior engineers");
    expect(text).toMatch(/Skills: React, TypeScript, Next\.js/);
    // Claude isn't shown a flagged claim as one to keep.
    expect(text).not.toContain("team of 12");
    expect(text).not.toContain("GraphQL");
  });
});
