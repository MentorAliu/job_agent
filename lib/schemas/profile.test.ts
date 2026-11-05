import { describe, expect, it } from "vitest";

import recorded from "@/test/fixtures/claude/parse-cv-response.json";

import { toFieldErrors } from "./action";
import {
  answersSchema,
  cvExtractionSchema,
  defaultAnswers,
  defaultPreferences,
  factIds,
  factIdSchema,
  masterProfileSchema,
  newFactId,
  normalizePartialDate,
  normalizeUrl,
  ownerLink,
  ownerLinks,
  preferencesSchema,
  toMasterProfile,
  type MasterProfile,
} from "./profile";
import { samplePreferences } from "@/test/sample-preferences";

function recordedProfile(): MasterProfile {
  const text = recorded.body.content[0].text;
  return toMasterProfile(cvExtractionSchema.parse(JSON.parse(text)));
}

describe("master profile schema", () => {
  it("accepts the profile read from the recorded CV", () => {
    expect(masterProfileSchema.parse(recordedProfile())).toBeTruthy();
  });

  it("reports nested errors at the form field's path", () => {
    const profile = recordedProfile();
    profile.basics.name = " ";
    profile.experience[1].title = "";
    profile.experience[1].startDate = "June 2019";
    profile.projects[0].url = "not a url";
    profile.experience[0].highlights[0].text = "";

    const result = masterProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
    const { fieldErrors } = toFieldErrors(result.error!);
    expect(Object.keys(fieldErrors).sort()).toEqual([
      "basics.name",
      "experience.0.highlights.0.text",
      "experience.1.startDate",
      "experience.1.title",
      "projects.0.url",
    ]);
    expect(fieldErrors["experience.1.title"]).toEqual(["Enter the job title."]);
  });

  it("rejects an end date before the start date", () => {
    const profile = recordedProfile();
    profile.experience[1].endDate = "2018-01";
    const result = masterProfileSchema.safeParse(profile);
    expect(toFieldErrors(result.error!).fieldErrors).toHaveProperty(
      "experience.1.endDate",
    );
  });

  it("rejects duplicate fact ids", () => {
    const profile = recordedProfile();
    profile.skills[1].id = profile.skills[0].id;
    const result = masterProfileSchema.safeParse(profile);
    expect(toFieldErrors(result.error!).formErrors[0]).toMatch(
      /Duplicate fact id/,
    );
  });
});

describe("toMasterProfile", () => {
  it("gives every fact a fresh, valid id", () => {
    const a = recordedProfile();
    const b = recordedProfile();
    expect(factIdSchema.safeParse(a.experience[0].id).success).toBe(true);
    expect(a.experience[0].id).toMatch(/^role_/);
    expect(a.experience[0].highlights[0].id).toMatch(/^hl_/);
    expect(a.skills[0].id).not.toBe(b.skills[0].id);
  });

  it("gives the headline and summary a fact id to cite", () => {
    const profile = recordedProfile();
    expect(profile.basics.id).toMatch(/^basics_[a-z0-9]{8}$/);
    expect(factIds(profile)[0]).toBe(profile.basics.id);
  });

  it("marks a role ending 'Present' as current", () => {
    const cv = cvExtractionSchema.parse(
      JSON.parse(recorded.body.content[0].text),
    );
    cv.experience[1] = {
      ...cv.experience[1],
      endDate: "Present",
      current: false,
    };
    const role = toMasterProfile(cv).experience[1];
    expect(role).toMatchObject({ current: true, endDate: "" });
  });
});

describe("normalizers", () => {
  it.each([
    ["2021", "2021"],
    ["2021-3", "2021-03"],
    ["2021/03/15", "2021-03"],
    ["03/2021", "2021-03"],
    ["Mar 2021", "2021-03"],
    ["September 2019", "2019-09"],
    ["Present", ""],
    ["", ""],
    ["Spring 2020", "Spring 2020"],
  ])("normalizePartialDate(%j) is %j", (input, expected) => {
    expect(normalizePartialDate(input)).toBe(expected);
  });

  it.each([
    ["github.com/jane", "https://github.com/jane"],
    ["https://jane.dev", "https://jane.dev"],
    ["", ""],
    ["Jane's site", "Jane's site"],
  ])("normalizeUrl(%j) is %j", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("makes ids from the right alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(newFactId("skill")).toMatch(/^skill_[a-z0-9]{8}$/);
    }
  });
});

describe("preferences schema", () => {
  it("starts with any kind of role, and asks where you can work", () => {
    expect(defaultPreferences.roleFocus).toBe("any");
    const result = preferencesSchema.safeParse(defaultPreferences);
    expect(
      Object.keys(toFieldErrors(result.error!).fieldErrors).sort(),
    ).toEqual(["countries", "timeZones"]);
    expect(preferencesSchema.parse(samplePreferences)).toEqual(
      samplePreferences,
    );
  });

  it("rejects an unknown time zone and a bad currency", () => {
    const result = preferencesSchema.safeParse({
      ...samplePreferences,
      timeZones: ["Europe/Belgrade", "Mars/Olympus"],
      salaryFloor: { amount: 40000, currency: "euro", period: "year" },
    });
    expect(
      Object.keys(toFieldErrors(result.error!).fieldErrors).sort(),
    ).toEqual(["salaryFloor.currency", "timeZones.1"]);
  });

  it("needs at least one country", () => {
    const result = preferencesSchema.safeParse({
      ...samplePreferences,
      countries: [],
    });
    expect(toFieldErrors(result.error!).fieldErrors.countries).toEqual([
      "Add at least one country you can work from.",
    ]);
  });
});

describe("answers schema", () => {
  it("accepts the defaults and rejects a link that isn't a URL", () => {
    expect(answersSchema.parse(defaultAnswers)).toEqual(defaultAnswers);
    const result = answersSchema.safeParse({
      ...defaultAnswers,
      links: { ...defaultAnswers.links, github: "github" },
    });
    expect(toFieldErrors(result.error!).fieldErrors).toHaveProperty(
      "links.github",
    );
  });
});

describe("owner links", () => {
  const profileLinks = [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/old" },
    { label: "Portfolio", url: "https://jane.github.io" },
    { label: "Blog", url: "https://blog.example.com" },
  ];

  it("keeps the profile's links when no standard answer has one", () => {
    expect(ownerLinks(profileLinks, null)).toEqual([
      { ...profileLinks[0], kind: "linkedin" },
      { ...profileLinks[1], kind: "portfolio" },
      { ...profileLinks[2], kind: null },
    ]);
    expect(ownerLinks(profileLinks, defaultAnswers.links)).toHaveLength(3);
  });

  it("puts a saved answer in place of the profile's link of that kind, and adds the others after", () => {
    const links = ownerLinks(profileLinks, {
      linkedin: "https://www.linkedin.com/in/new",
      github: "https://github.com/jane",
      portfolio: "",
    });
    expect(links).toEqual([
      {
        label: "LinkedIn",
        url: "https://www.linkedin.com/in/new",
        kind: "linkedin",
      },
      { label: "Portfolio", url: "https://jane.github.io", kind: "portfolio" },
      { label: "Blog", url: "https://blog.example.com", kind: null },
      { label: "GitHub", url: "https://github.com/jane", kind: "github" },
    ]);
    expect(ownerLink(links, "github")).toBe("https://github.com/jane");
    expect(ownerLink(links, "portfolio")).toBe("https://jane.github.io");
  });

  it("knows a link by its URL when its name doesn't say", () => {
    const links = ownerLinks(
      [{ label: "Code", url: "https://github.com/jane" }],
      null,
    );
    expect(ownerLink(links, "github")).toBe("https://github.com/jane");
    expect(ownerLink(links, "linkedin")).toBe("");
  });

  it("doesn't draw the same link twice", () => {
    const links = ownerLinks([{ label: "Site", url: "https://jane.dev/" }], {
      linkedin: "",
      github: "",
      portfolio: "https://www.jane.dev",
    });
    expect(links).toEqual([
      { label: "Site", url: "https://www.jane.dev", kind: "portfolio" },
    ]);
    const same = ownerLinks([{ label: "Me", url: "https://jane.dev" }], {
      linkedin: "",
      github: "",
      portfolio: "https://jane.dev/",
    });
    expect(same).toEqual([
      { label: "Me", url: "https://jane.dev", kind: "portfolio" },
    ]);
    expect(ownerLink(same, "portfolio")).toBe("https://jane.dev");
  });
});
