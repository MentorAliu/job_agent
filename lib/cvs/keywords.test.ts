import { describe, expect, it } from "vitest";

import type { JobFacts } from "@/lib/schemas/job";
import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import profileJson from "@/test/fixtures/profile.json";

import {
  backedKeywords,
  keywordCoverage,
  normalizeForMatch,
  postingKeywords,
  skillsForKeywords,
} from "./keywords";

const cv = [
  "Senior Frontend Engineer",
  "Rebuilt the dashboard in Next.js with ReactJS and TypeScript.",
  "Mentored engineers through weekly code reviews.",
  "Skills: C#, C++, Node.js",
].join("\n");
const profile = `${cv}\nFigma\nPostgreSQL`;

describe("keywordCoverage", () => {
  it("says, for each keyword, whether it's on the CV or only in the profile", () => {
    expect(
      keywordCoverage(
        ["TypeScript", "Code reviews", "Figma", "GraphQL"],
        cv,
        profile,
      ),
    ).toEqual([
      { term: "TypeScript", onCv: true, inProfile: true },
      { term: "Code reviews", onCv: true, inProfile: true },
      { term: "Figma", onCv: false, inProfile: true },
      { term: "GraphQL", onCv: false, inProfile: false },
    ]);
  });

  it("matches whole words only, keeping the symbols in C# and C++", () => {
    const [java, cSharp, cPlus, c] = keywordCoverage(
      ["Java", "C#", "C++", "C"],
      cv,
      profile,
    );
    expect(java.onCv).toBe(false);
    expect(cSharp.onCv).toBe(true);
    expect(cPlus.onCv).toBe(true);
    expect(c.onCv).toBe(false);
  });

  it("matches React.js as React, but never Next.js as the word next", () => {
    const [react, next] = keywordCoverage(
      ["React.js", "Next.js"],
      "Built it in React.",
      "",
    );
    expect(react.onCv).toBe(true);
    expect(next.onCv).toBe(false);
  });

  it("lists a keyword once, however it's written, and drops empty ones", () => {
    expect(
      keywordCoverage(["Node.js", " node.js ", "", "  "], cv, profile),
    ).toEqual([{ term: "Node.js", onCv: true, inProfile: true }]);
  });

  it("matches short names such as Go and REST only as written", () => {
    const [go, rest, aws] = keywordCoverage(
      ["Go", "REST", "AWS"],
      "Built REST APIs on aws.",
      "The go-to person for the rest of the team.",
    );
    expect(go).toMatchObject({ onCv: false, inProfile: false });
    expect(rest).toMatchObject({ onCv: true, inProfile: true });
    expect(aws).toMatchObject({ onCv: false, inProfile: false });
  });
});

// The profile fixture's skills: TypeScript, JavaScript, HTML, CSS, React,
// Next.js, Svelte, React Native, Node.js, PostgreSQL, Jest, Playwright, Git
// and Figma, plus each role's technologies (TanStack Query, Redux...).
const master: MasterProfile = masterProfileSchema.parse(profileJson);

/** The facts a posting's reading gives, with only what keywords use. */
function facts(stack: string[], requirements: string[] = []): JobFacts {
  return { stack, requirements, summary: "" } as unknown as JobFacts;
}

describe("postingKeywords", () => {
  it("lists the posting's stack first, then profile skills the posting mentions", () => {
    expect(
      postingKeywords(
        {
          title: "Senior Frontend Engineer",
          facts: facts(
            ["React.js", "TypeScript", "GraphQL"],
            ["Experience testing with Playwright"],
          ),
          description:
            "We use Redux and Figma. Let's go: the rest is up to you, git it?",
        },
        master,
      ),
    ).toEqual([
      "React.js",
      "TypeScript",
      "GraphQL",
      "Playwright",
      "Figma",
      "Redux",
    ]);
  });

  it("works from the posting text alone when it wasn't read for facts", () => {
    expect(
      postingKeywords(
        {
          title: "Frontend Engineer (Next.js)",
          facts: null,
          description: "You'll build our app in TypeScript with Jest tests.",
        },
        master,
      ),
    ).toEqual(["TypeScript", "Next.js", "Jest"]);
  });

  it("keeps at most 20", () => {
    const stack = Array.from({ length: 25 }, (_, index) => `Tool${index}`);
    expect(
      postingKeywords(
        { title: "Engineer", facts: facts(stack), description: null },
        master,
      ),
    ).toHaveLength(20);
  });
});

describe("backedKeywords", () => {
  it("keeps only the keywords the profile states", () => {
    expect(
      backedKeywords(["React.js", "GraphQL", "TanStack Query", "Go"], master),
    ).toEqual(["React.js", "TanStack Query"]);
  });
});

describe("skillsForKeywords", () => {
  it("picks the profile's skills for keywords it has and the CV doesn't use", () => {
    const keywords = [
      { term: "TypeScript", onCv: true, inProfile: true },
      { term: "Figma", onCv: false, inProfile: true },
      { term: "React Native", onCv: false, inProfile: true },
      // In the profile, but only as a role's technology: no skill to add.
      { term: "Redux", onCv: false, inProfile: true },
      { term: "GraphQL", onCv: false, inProfile: false },
    ];
    expect(skillsForKeywords(keywords, master, ["skill_00000017"])).toEqual([
      { id: "skill_00000024", name: "React Native" },
      { id: "skill_00000030", name: "Figma" },
    ]);
  });

  it("leaves out skills the CV lists already", () => {
    expect(
      skillsForKeywords(
        [{ term: "Figma", onCv: false, inProfile: true }],
        master,
        ["skill_00000030"],
      ),
    ).toEqual([]);
  });
});

describe("normalizeForMatch", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalizeForMatch("Résumé, Nikšić!")).toBe(" resume niksic ");
  });
});
