import { describe, expect, it } from "vitest";

import { emptyMasterProfile, type MasterProfile } from "@/lib/schemas/profile";
import profileFixture from "@/test/fixtures/profile.json";
import { samplePreferences } from "@/test/sample-preferences";

import {
  answerList,
  choicesFor,
  countryFromCv,
  focusFromCv,
  preferencesWith,
  seniorityFromCv,
  stackFromCv,
  startingAnswers,
} from "./prefill";

const profile = profileFixture as MasterProfile;

/** The fixture with another headline and location. */
function withBasics(basics: Partial<MasterProfile["basics"]>): MasterProfile {
  return { ...profile, basics: { ...profile.basics, ...basics } };
}

describe("focusFromCv", () => {
  it("reads the kind of role from the headline", () => {
    expect(focusFromCv(profile)).toBe("frontend");
    expect(focusFromCv(withBasics({ headline: "Full-stack Developer" }))).toBe(
      "fullstack",
    );
    expect(focusFromCv(withBasics({ headline: "Senior iOS Engineer" }))).toBe(
      "mobile",
    );
  });

  it("falls back to the latest role, then to any kind", () => {
    expect(focusFromCv(withBasics({ headline: "" }))).toBe("frontend");
    expect(focusFromCv(withBasics({ headline: "Problem solver" }))).toBe("any");
    expect(focusFromCv(null)).toBe("any");
    expect(focusFromCv(emptyMasterProfile())).toBe("any");
  });
});

describe("seniorityFromCv", () => {
  it("offers the level the title says and the one above it", () => {
    expect(seniorityFromCv(profile)).toEqual(["senior", "lead"]);
    expect(
      seniorityFromCv(withBasics({ headline: "Mid-level Engineer" })),
    ).toEqual(["mid", "senior"]);
    expect(
      seniorityFromCv(withBasics({ headline: "Staff Frontend Engineer" })),
    ).toEqual(["principal"]);
  });

  it("offers a junior only junior roles", () => {
    expect(
      seniorityFromCv(withBasics({ headline: "Junior Web Developer" })),
    ).toEqual(["junior"]);
  });

  it("suggests nothing when the title doesn't say", () => {
    expect(
      seniorityFromCv(withBasics({ headline: "Frontend Engineer" })),
    ).toEqual([]);
    expect(seniorityFromCv(null)).toEqual([]);
  });
});

describe("countryFromCv", () => {
  it("takes the last part of the location", () => {
    expect(countryFromCv(profile)).toEqual(["Montenegro"]);
    expect(countryFromCv(withBasics({ location: "Portugal" }))).toEqual([
      "Portugal",
    ]);
    expect(
      countryFromCv(withBasics({ location: "Porto, Norte , Portugal " })),
    ).toEqual(["Portugal"]);
  });

  it("ignores a location that isn't a place", () => {
    expect(countryFromCv(withBasics({ location: "Remote" }))).toEqual([]);
    expect(countryFromCv(withBasics({ location: "Anywhere" }))).toEqual([]);
    expect(countryFromCv(withBasics({ location: "" }))).toEqual([]);
    expect(countryFromCv(null)).toEqual([]);
  });
});

describe("stackFromCv", () => {
  it("offers the CV's skills in its order, each once", () => {
    const stack = stackFromCv({
      ...profile,
      skills: [
        { id: "skill_1", name: "React", category: "Frameworks" },
        { id: "skill_2", name: " react ", category: "Frameworks" },
        { id: "skill_3", name: "TypeScript", category: "Languages" },
      ],
    });
    expect(stack).toEqual(["React", "TypeScript"]);
  });

  it("leaves out people skills", () => {
    const stack = stackFromCv({
      ...profile,
      skills: [
        { id: "skill_1", name: "Mentoring", category: "Soft skills" },
        { id: "skill_2", name: "Next.js", category: "Frameworks" },
        { id: "skill_3", name: "Teamwork", category: "Interpersonal" },
      ],
    });
    expect(stack).toEqual(["Next.js"]);
  });

  it("offers at most 16", () => {
    const skills = Array.from({ length: 20 }, (_, index) => ({
      id: `skill_${index}`,
      name: `Tool ${index}`,
      category: "Tools",
    }));
    expect(stackFromCv({ ...profile, skills })).toHaveLength(16);
  });
});

describe("startingAnswers", () => {
  it("starts from the CV, with the app's time zone", () => {
    expect(startingAnswers(profile, null, "Europe/Belgrade")).toEqual({
      roleFocus: "frontend",
      seniority: ["senior", "lead"],
      countries: ["Montenegro"],
      timeZones: ["Europe/Belgrade"],
      stack: profile.skills.map((skill) => skill.name),
    });
  });

  it("doesn't suggest UTC, which is only the default", () => {
    expect(startingAnswers(profile, null, "UTC").timeZones).toEqual([]);
  });

  it("keeps the saved answers over the CV", () => {
    const saved = { ...samplePreferences, stack: ["Vue"], seniority: [] };
    expect(startingAnswers(profile, saved, "UTC")).toEqual({
      roleFocus: "frontend",
      seniority: [],
      countries: ["Montenegro"],
      timeZones: ["Europe/Belgrade"],
      stack: ["Vue"],
    });
  });
});

describe("choicesFor and answerList", () => {
  it("lists the picked choices first, then the other suggestions, each once", () => {
    expect(
      choicesFor(["Montenegro", "Albania"], ["montenegro", "Portugal"]),
    ).toEqual(["Montenegro", "Albania", "Portugal"]);
  });

  it("splits what was typed at commas and keeps each answer once", () => {
    expect(
      answerList(["Montenegro", "Albania, montenegro , ", " North Macedonia"]),
    ).toEqual(["Montenegro", "Albania", "North Macedonia"]);
    expect(answerList([""])).toEqual([]);
  });

  it("ignores files", () => {
    expect(answerList([new File(["x"], "cv.pdf"), "React"])).toEqual(["React"]);
  });
});

describe("preferencesWith", () => {
  it("puts the answers in and keeps the rest, remote only on", () => {
    const base = {
      ...samplePreferences,
      remoteOnly: false,
      excludedCompanies: ["Initech"],
    };
    const next = preferencesWith(base, {
      roleFocus: "backend",
      seniority: ["senior"],
      countries: ["Portugal"],
      timeZones: ["Europe/Lisbon"],
      stack: ["Go"],
    });
    expect(next).toEqual({
      ...base,
      remoteOnly: true,
      roleFocus: "backend",
      seniority: ["senior"],
      countries: ["Portugal"],
      timeZones: ["Europe/Lisbon"],
      stack: ["Go"],
    });
  });
});
