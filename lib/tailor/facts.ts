// The profile as citable facts: every fact id with the text it stands for.
// Tailoring (step 8) sees this list, cites the ids, and the claim check
// (step 9) reads back the text of each cited id.
import type {
  Answers,
  MasterProfile,
  Preferences,
} from "@/lib/schemas/profile";

/**
 * Ids for the standard answers, which have no fact id of their own. They
 * follow the fact id format, so citations of them pass the same check.
 */
export const STANDARD_ANSWER_IDS = {
  noticePeriod: "std_noticepd",
  workAuthorization: "std_workauth",
} as const;

/** Whether a fact id is one of the owner's standard or saved answers. */
export function isStandardAnswerId(id: string): boolean {
  return (
    id.startsWith("qa_") ||
    (Object.values(STANDARD_ANSWER_IDS) as string[]).includes(id)
  );
}

/** The id for the time zones in the job preferences. */
export const TIME_ZONE_FACT_ID = "pref_timezone";

/**
 * Fixed winter and summer dates, so a fact's text stays the same from day to
 * day. Names can still change with the time zone data in Node.
 */
const JANUARY = new Date("2026-01-15T12:00:00Z");
const JULY = new Date("2026-07-15T12:00:00Z");

function zonePart(
  timeZone: string,
  at: Date,
  style: "long" | "shortOffset",
): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

/**
 * "Europe/Belgrade (Central European Time, UTC+1, or UTC+2 with daylight
 * saving)": the name and offsets, so a claim like "on CET" can be checked.
 */
export function describeTimeZone(timeZone: string): string {
  // "GMT+5:30" as minutes east of UTC; daylight saving is the larger one.
  const minutes = (offset: string) => {
    const [, sign, hours, mins] =
      /^GMT(?:([+-])(\d+)(?::(\d+))?)?$/.exec(offset) ?? [];
    const total = Number(hours ?? 0) * 60 + Number(mins ?? 0);
    return sign === "-" ? -total : total;
  };
  const [standard, daylight] = [JANUARY, JULY]
    .map((at) => zonePart(timeZone, at, "shortOffset"))
    .sort((a, b) => minutes(a) - minutes(b))
    // Newer time zone data writes London's winter offset as "GMT+0".
    .map((offset) =>
      offset.replace(/^GMT([+-]0)?$/, "UTC").replace(/^GMT/, "UTC"),
    );
  const longName = zonePart(timeZone, JANUARY, "long");
  // "Central European Standard Time" is "Central European Time" all year.
  const name =
    standard === daylight
      ? longName
      : longName.replace(/ (Standard|Daylight|Summer) Time$/, " Time");
  return `${timeZone} (${joined([
    name.startsWith("GMT") ? "" : name,
    standard === daylight
      ? standard
      : `${standard}, or ${daylight} with daylight saving`,
  ])})`;
}

export type Fact = {
  id: string;
  /** What the fact says, in one line. */
  text: string;
  /** The role or project a highlight belongs to; the entry itself for a role or project. */
  entryId: string | null;
};

const dates = (start: string, end: string, current = false) =>
  `${start || "?"} to ${current ? "now" : end || "?"}`;
const joined = (parts: string[], separator = ", ") =>
  parts.filter((part) => part.trim() !== "").join(separator);

/**
 * Every citable fact, in profile order. Contact details stay out: tailoring
 * doesn't need them, and the CV header is filled in by the code.
 */
export function profileFacts(
  profile: MasterProfile,
  answers: Answers | null,
  preferences: Preferences | null = null,
): Fact[] {
  const facts: Fact[] = [];
  const { basics } = profile;
  facts.push({
    id: basics.id,
    text: joined(
      [
        basics.headline && `Headline: ${basics.headline}`,
        basics.location && `Based in ${basics.location}`,
        basics.summary && `Summary: ${basics.summary}`,
      ],
      ". ",
    ),
    entryId: null,
  });

  for (const role of profile.experience) {
    facts.push({
      id: role.id,
      text: joined(
        [
          `${role.title} at ${role.company} (${dates(role.startDate, role.endDate, role.current)})`,
          role.location,
          role.summary,
          role.technologies.length > 0
            ? `Technologies: ${role.technologies.join(", ")}`
            : "",
        ],
        ". ",
      ),
      entryId: role.id,
    });
    for (const highlight of role.highlights) {
      facts.push({ id: highlight.id, text: highlight.text, entryId: role.id });
    }
  }
  for (const project of profile.projects) {
    facts.push({
      id: project.id,
      text: joined(
        [
          `Project ${project.name}${project.role ? ` (${project.role})` : ""}`,
          project.startDate || project.endDate
            ? dates(project.startDate, project.endDate)
            : "",
          project.summary,
          project.technologies.length > 0
            ? `Technologies: ${project.technologies.join(", ")}`
            : "",
        ],
        ". ",
      ),
      entryId: project.id,
    });
    for (const highlight of project.highlights) {
      facts.push({
        id: highlight.id,
        text: highlight.text,
        entryId: project.id,
      });
    }
  }
  for (const skill of profile.skills) {
    facts.push({
      id: skill.id,
      text: `Skill: ${skill.name}${skill.category ? ` (${skill.category})` : ""}`,
      entryId: null,
    });
  }
  for (const entry of profile.education) {
    facts.push({
      id: entry.id,
      text: joined(
        [
          `Education: ${joined([entry.degree, entry.field]) || "Studies"} at ${entry.institution} (${dates(entry.startDate, entry.endDate)})`,
          entry.details,
        ],
        ". ",
      ),
      entryId: null,
    });
  }
  for (const cert of profile.certifications) {
    facts.push({
      id: cert.id,
      text: `Certification: ${joined([cert.name, cert.issuer, cert.date])}`,
      entryId: null,
    });
  }
  for (const language of profile.languages) {
    facts.push({
      id: language.id,
      text: `Speaks ${language.name}${language.level ? ` (${language.level})` : ""}`,
      entryId: null,
    });
  }

  if (answers) {
    if (answers.noticePeriod) {
      facts.push({
        id: STANDARD_ANSWER_IDS.noticePeriod,
        text: `Notice period: ${answers.noticePeriod}`,
        entryId: null,
      });
    }
    if (answers.workAuthorization) {
      facts.push({
        id: STANDARD_ANSWER_IDS.workAuthorization,
        text: `Work authorization: ${answers.workAuthorization}`,
        entryId: null,
      });
    }
    for (const extra of answers.extra) {
      facts.push({
        id: extra.id,
        text: `Saved answer to "${extra.question}": ${extra.answer}`,
        entryId: null,
      });
    }
  }
  if (preferences && preferences.timeZones.length > 0) {
    facts.push({
      id: TIME_ZONE_FACT_ID,
      text: `Can work in the time zones: ${preferences.timeZones.map(describeTimeZone).join("; ")}`,
      entryId: null,
    });
  }
  return facts;
}

export function factIndex(facts: Fact[]): Map<string, Fact> {
  return new Map(facts.map((fact) => [fact.id, fact]));
}

/**
 * The facts as the cached part of a tailoring request: one per line, with
 * its id in brackets and a role's highlights indented under it.
 */
export function profileFactsText(
  profile: MasterProfile,
  answers: Answers | null,
  preferences: Preferences | null = null,
): string {
  const facts = profileFacts(profile, answers, preferences);
  const lines = [
    "# Candidate profile",
    "Each fact has its id in brackets. Cite these ids.",
    "",
  ];
  const unanswered: string[] = [];
  for (const fact of facts) {
    const indent = fact.entryId && fact.entryId !== fact.id ? "  " : "";
    lines.push(`${indent}[${fact.id}] ${fact.text}`);
  }
  if (!answers?.noticePeriod) unanswered.push("notice period");
  if (!answers?.workAuthorization) unanswered.push("work authorization");
  if (unanswered.length > 0) {
    lines.push(
      "",
      `The candidate hasn't saved their ${unanswered.join(" or ")}. Never guess them.`,
    );
  }
  return lines.join("\n");
}
