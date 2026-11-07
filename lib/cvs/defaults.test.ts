import { describe, expect, it } from "vitest";

import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import profileJson from "@/test/fixtures/profile.json";

import { defaultCvForm, formFromRequest, resolveLeadSkills } from "./defaults";
import { samplePreferences } from "@/test/sample-preferences";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);

describe("defaultCvForm", () => {
  it("aims at the headline and leads with the stack the profile backs", () => {
    const form = defaultCvForm(profile, {
      ...samplePreferences,
      // Go isn't in the profile, so it's not offered.
      stack: ["typescript", "React", "Go", "Next.js"],
    }, "minimal");
    expect(form).toEqual({
      targetTitle: "Senior Frontend Engineer",
      jobText: "",
      skills: ["TypeScript", "React", "Next.js"],
      length: "one_page",
      sections: ["projects", "education", "certifications", "languages"],
      note: "",
      template: "minimal",
    });
  });

  it("falls back to the profile's first skills and its first role's title", () => {
    const form = defaultCvForm(
      {
        ...profile,
        basics: { ...profile.basics, headline: " " },
        certifications: [],
        languages: [],
      },
      null,
      "modern",
    );
    expect(form.targetTitle).toBe("Senior Frontend Engineer");
    expect(form.skills).toEqual(
      profile.skills.slice(0, 8).map((skill) => skill.name),
    );
    expect(form.sections).toEqual(["projects", "education"]);
  });

  it("gives a long career two pages", () => {
    const role = profile.experience[2];
    const form = defaultCvForm(
      {
        ...profile,
        experience: [...profile.experience, { ...role, id: "role_99999990" }],
      },
      null,
      "modern",
    );
    expect(form.length).toBe("two_pages");
  });
});

describe("resolveLeadSkills", () => {
  it("uses the profile's skill ids and adds the ones it doesn't have", () => {
    const { skillIds, added } = resolveLeadSkills(profile, [
      "react",
      "TypeScript",
      "  Claude   Code ",
      "React",
      "claude code",
    ]);
    expect(added).toEqual([
      {
        id: expect.stringMatching(/^skill_/),
        name: "Claude Code",
        category: "",
      },
    ]);
    expect(skillIds).toEqual(["skill_00000021", "skill_00000017", added[0].id]);
  });
});

describe("formFromRequest", () => {
  it("names the skills again, skipping any the profile no longer has", () => {
    const form = formFromRequest(
      {
        targetTitle: "Frontend Lead",
        jobText: "A posting",
        skillIds: ["skill_00000022", "skill_gone0000", "skill_00000017"],
        length: "two_pages",
        sections: ["education"],
        note: "Stress mentoring.",
      },
      profile,
    );
    expect(form).toEqual({
      targetTitle: "Frontend Lead",
      jobText: "A posting",
      skills: ["Next.js", "TypeScript"],
      length: "two_pages",
      sections: ["education"],
      note: "Stress mentoring.",
      // Built before designs existed, so drawn in the first one.
      template: "classic",
    });
  });

  it("keeps the design the CV was built in", () => {
    const form = formFromRequest(
      {
        targetTitle: "Frontend Lead",
        jobText: "",
        skillIds: [],
        length: "one_page",
        sections: [],
        note: "",
        template: "executive",
      },
      profile,
    );
    expect(form.template).toBe("executive");
  });
});
