import { describe, expect, it } from "vitest";

import type { JobFacts } from "@/lib/schemas/job";

import {
  checkEligibility,
  ownerOffsets,
  parseTimeZoneWindow,
  quoteInPage,
} from "./eligibility";
import { samplePreferences } from "@/test/sample-preferences";

// The owner's defaults: remote only, Montenegro, Europe/Belgrade (UTC+1, +2 in summer).
const owner = samplePreferences;

type Rules = Pick<JobFacts, "location" | "timeZones">;

/** Facts as Claude copies them from a posting, with nothing filled in. */
function facts(overrides: {
  location?: Partial<Rules["location"]>;
  timeZones?: Partial<Rules["timeZones"]>;
}): Rules {
  return {
    location: {
      workplace: "remote",
      quote: "",
      allowed: [],
      placesAre: "required",
      excluded: [],
      ...overrides.location,
    },
    timeZones: {
      quote: "",
      utcOffsetMin: null,
      utcOffsetMax: null,
      ...overrides.timeZones,
    },
  };
}

describe("checkEligibility on sample postings", () => {
  it('"US only" is not eligible', () => {
    const page = `# Senior Frontend Engineer\n\n**Location:** Remote (US only)\n\nWe're hiring across the United States.`;
    const result = checkEligibility(
      facts({
        location: {
          quote: "Location: Remote (US only)",
          allowed: ["United States"],
        },
      }),
      owner,
      page,
    );
    expect(result.eligibility).toBe("not_eligible");
    expect(result.quote).toBe("Location: Remote (US only)");
    expect(result.reasons[0]).toMatch(/only open to United States/);
  });

  it('"EU only" is not eligible', () => {
    const page = `Full-stack Developer\nThis role is remote, EU only. You must live in an EU member state.`;
    const result = checkEligibility(
      facts({
        location: { quote: "This role is remote, EU only.", allowed: ["EU"] },
      }),
      owner,
      page,
    );
    expect(result.eligibility).toBe("not_eligible");
    expect(result.quote).toBe("This role is remote, EU only.");
  });

  it('"Europe" is eligible', () => {
    const page = `Backend Engineer (TypeScript)\nRemote — anywhere in Europe.`;
    const result = checkEligibility(
      facts({
        location: {
          quote: "Remote — anywhere in Europe.",
          allowed: ["Europe"],
        },
      }),
      owner,
      page,
    );
    expect(result).toEqual({
      eligibility: "eligible",
      quote: "Remote — anywhere in Europe.",
      reasons: ["The posting is open to Europe, which includes Montenegro."],
    });
  });

  it('"CET ±2" is eligible', () => {
    const page = `React Engineer\nFully remote. You need to work within CET ±2 hours.`;
    const result = checkEligibility(
      facts({
        timeZones: {
          quote: "You need to work within CET ±2 hours.",
          utcOffsetMin: -1,
          utcOffsetMax: 3,
        },
      }),
      owner,
      page,
    );
    expect(result.eligibility).toBe("eligible");
    expect(result.quote).toBe("You need to work within CET ±2 hours.");
    expect(result.reasons[0]).toMatch(/Europe\/Belgrade is inside/);
  });

  it("a posting that says nothing about location is unclear", () => {
    const page = `Software Engineer\nJoin our remote team building developer tools.`;
    const result = checkEligibility(facts({}), owner, page);
    expect(result).toEqual({
      eligibility: "unclear",
      quote: "",
      reasons: ["The posting doesn't say where you can work from."],
    });
  });
});

describe("checkEligibility rules", () => {
  it("passes Worldwide, EMEA and the owner's own country", () => {
    for (const allowed of [
      ["Worldwide"],
      ["EMEA"],
      ["Montenegro"],
      ["Western Balkans"],
    ]) {
      const quote = `Open to candidates in ${allowed[0]}.`;
      const result = checkEligibility(
        facts({ location: { quote, allowed } }),
        owner,
        quote,
      );
      expect(result.eligibility, allowed[0]).toBe("eligible");
      expect(result.reasons[0], allowed[0]).toBe(
        allowed[0] === "Worldwide"
          ? "The posting is open worldwide."
          : `The posting is open to ${allowed[0]}, which includes Montenegro.`,
      );
    }
  });

  it("fails a list of countries that doesn't include the owner's", () => {
    const quote = "Remote in Germany, Poland or Portugal.";
    const result = checkEligibility(
      facts({
        location: { quote, allowed: ["Germany", "Poland", "Portugal"] },
      }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("not_eligible");
  });

  it("is unclear about a place it can't match", () => {
    const quote = "Remote within the Mercosur bloc.";
    const result = checkEligibility(
      facts({ location: { quote, allowed: ["Mercosur"] } }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("unclear");
    expect(result.quote).toBe(quote);
  });

  it("is unclear when the posting only prefers some places", () => {
    // From a live run: Maze's posting.
    const quote =
      "Remote, preference for Netherlands, United Kingdom, Ireland, Spain or Portugal";
    const allowed = [
      "Netherlands",
      "United Kingdom",
      "Ireland",
      "Spain",
      "Portugal",
    ];
    const result = checkEligibility(
      facts({ location: { quote, allowed, placesAre: "preferred" } }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("unclear");
    expect(result.quote).toBe(quote);
    expect(result.reasons).toEqual([
      "The posting prefers candidates in Netherlands, United Kingdom, Ireland, Spain, or Portugal, but doesn't rule out Montenegro.",
    ]);

    const preferred = checkEligibility(
      facts({
        location: { quote, allowed: ["Europe"], placesAre: "preferred" },
      }),
      owner,
      quote,
    );
    expect(preferred.eligibility).toBe("eligible");
    expect(preferred.reasons[0]).toBe(
      "The posting prefers candidates in Europe, which includes Montenegro.",
    );
  });

  it("is unclear when the places only say where the team is", () => {
    // From a live run: Plentific's posting.
    const quote =
      "we currently have remote engineers based in the UK, Germany, Turkey, Poland, Italy, Spain, and Portugal.";
    const result = checkEligibility(
      facts({
        location: {
          quote,
          allowed: ["United Kingdom", "Germany", "Turkey", "Poland"],
          placesAre: "team_locations",
        },
      }),
      owner,
      `About the team: ${quote}`,
    );
    expect(result.eligibility).toBe("unclear");
    expect(result.reasons[0]).toBe(
      "The posting says where its team is (United Kingdom, Germany, Turkey, and Poland), not where you must live.",
    );
  });

  it("still fails a preference that excludes the owner's country", () => {
    const quote = "Preference for Western Europe; we can't hire in Montenegro.";
    const result = checkEligibility(
      facts({
        location: {
          quote,
          allowed: ["Western Europe"],
          placesAre: "preferred",
          excluded: ["Montenegro"],
        },
      }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("not_eligible");
  });

  it("fails a posting that excludes the owner's country", () => {
    const quote = "Remote across Europe, excluding Montenegro and Serbia.";
    const result = checkEligibility(
      facts({
        location: {
          quote,
          allowed: ["Europe"],
          excluded: ["Montenegro", "Serbia"],
        },
      }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("not_eligible");
    expect(result.reasons[0]).toMatch(/excludes Montenegro/);
  });

  it("fails on-site and hybrid roles when the owner wants remote only", () => {
    const quote = "Hybrid: three days a week in our Berlin office.";
    const result = checkEligibility(
      facts({ location: { workplace: "hybrid", quote, allowed: ["Germany"] } }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("not_eligible");
    expect(result.reasons[0]).toMatch(/hybrid/);

    const flexible = checkEligibility(
      facts({ location: { workplace: "hybrid", quote, allowed: ["Europe"] } }),
      { ...owner, remoteOnly: false },
      quote,
    );
    expect(flexible.eligibility).toBe("eligible");
  });

  it("fails hybrid and on-site roles even when Claude's quote can't be used", () => {
    // A time zone the owner fits doesn't let a hybrid role through.
    const page =
      "Senior React Engineer\nLondon office, 2 days a week.\nHours: CET ±2.";
    const hybrid = checkEligibility(
      facts({
        location: { workplace: "hybrid", quote: "Hybrid, London." },
        timeZones: { quote: "CET ±2", utcOffsetMin: -1, utcOffsetMax: 3 },
      }),
      owner,
      page,
    );
    expect(hybrid).toEqual({
      eligibility: "not_eligible",
      quote: "",
      reasons: ["The role is hybrid, and you want remote work only."],
    });

    const onsite = checkEligibility(
      facts({ location: { workplace: "onsite" } }),
      owner,
      "Frontend Developer at our Munich office.",
    );
    expect(onsite.eligibility).toBe("not_eligible");
    expect(onsite.reasons).toEqual([
      "The role is on-site, and you want remote work only.",
    ]);
  });

  it("fails a posting that doesn't say it's remote when the owner wants remote only", () => {
    const quote = "Open to candidates across Europe.";
    const unsaid = facts({
      location: { workplace: "unclear", quote, allowed: ["Europe"] },
    });
    const result = checkEligibility(unsaid, owner, quote);
    expect(result.eligibility).toBe("not_eligible");
    expect(result.quote).toBe(quote);
    expect(result.reasons[0]).toBe(
      "The posting doesn't say the role is remote, and you want remote work only.",
    );

    expect(
      checkEligibility(unsaid, { ...owner, remoteOnly: false }, quote)
        .eligibility,
    ).toBe("eligible");
  });

  it("fails a time zone window the owner is outside", () => {
    const quote = "You must work Pacific hours (PT).";
    const result = checkEligibility(
      facts({ timeZones: { quote, utcOffsetMin: -8, utcOffsetMax: -7 } }),
      owner,
      quote,
    );
    expect(result.eligibility).toBe("not_eligible");
  });

  it("a blocking time zone rule wins over an allowed place", () => {
    const quote = "Worldwide, but you must overlap fully with EST.";
    const result = checkEligibility(
      facts({
        location: { quote: "Worldwide", allowed: ["Worldwide"] },
        timeZones: {
          quote: "UTC-5 to UTC-3",
          utcOffsetMin: -5,
          utcOffsetMax: -3,
        },
      }),
      owner,
      `${quote} Hours: UTC-5 to UTC-3.`,
    );
    expect(result.eligibility).toBe("not_eligible");
    expect(result.quote).toBe("UTC-5 to UTC-3");
  });

  it("ignores a rule whose quote isn't in the page", () => {
    const page = "Senior Engineer. Remote, US only.";
    const result = checkEligibility(
      facts({
        location: { quote: "Remote anywhere in Europe.", allowed: ["Europe"] },
      }),
      owner,
      page,
    );
    expect(result.eligibility).toBe("unclear");
    expect(result.reasons[0]).toMatch(/isn't in the posting/);
  });

  it("ignores places listed without a quote", () => {
    const result = checkEligibility(
      facts({ location: { allowed: ["Europe"] } }),
      owner,
      "Remote role.",
    );
    expect(result.eligibility).toBe("unclear");
  });
});

describe("parseTimeZoneWindow", () => {
  it("reads CET ±2 as UTC-1 to UTC+3, moving with summer time", () => {
    expect(parseTimeZoneWindow("CET ±2")).toEqual({
      january: { min: -1, max: 3 },
      july: { min: 0, max: 4 },
    });
    expect(parseTimeZoneWindow("within CET +/- 2 hours")).toEqual(
      parseTimeZoneWindow("CET ±2"),
    );
  });

  it("reads explicit ranges and nearby windows", () => {
    expect(parseTimeZoneWindow("Between UTC-1 and UTC+3")).toEqual({
      january: { min: -1, max: 3 },
      july: { min: -1, max: 3 },
    });
    expect(parseTimeZoneWindow("GMT+1 – GMT+3 preferred")?.january).toEqual({
      min: 1,
      max: 3,
    });
    expect(parseTimeZoneWindow("within 3 hours of GMT")?.january).toEqual({
      min: -3,
      max: 3,
    });
  });

  it("returns null when there's no range", () => {
    expect(parseTimeZoneWindow("Core hours 10:00-14:00 CET")).toBeNull();
    expect(parseTimeZoneWindow("Flexible hours")).toBeNull();
  });
});

describe("helpers", () => {
  it("knows Belgrade is UTC+1 in winter and UTC+2 in summer", () => {
    expect(ownerOffsets("Europe/Belgrade")).toEqual({ january: 1, july: 2 });
    expect(ownerOffsets("Not/AZone")).toBeNull();
  });

  it("finds quotes despite Markdown, curly quotes and line breaks", () => {
    const page = "**Location:**  Remote\n(anywhere in “Europe”) – apply now";
    expect(
      quoteInPage('Location: Remote (anywhere in "Europe") - apply now', page),
    ).toBe(true);
    expect(quoteInPage("Location: Remote (US only)", page)).toBe(false);
  });
});
