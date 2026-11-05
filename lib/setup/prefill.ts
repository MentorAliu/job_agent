// What setup suggests for "What you're looking for", from the CV the owner
// just gave it, so most questions only need a Next. Saved preferences win
// over anything suggested.
import { focusFromTitle } from "@/lib/jobs/role-focus";
import {
  SENIORITY_LEVELS,
  type MasterProfile,
  type Preferences,
  type WantedFocus,
} from "@/lib/schemas/profile";
import type { WantedAnswers } from "@/lib/schemas/setup";

/** How many of the profile's skills the stack question offers. */
const STACK_CHOICES = 16;

/** Skills in these categories are about people, not a stack to search for. */
const NOT_STACK = /\b(?:soft|interpersonal|people|personal|spoken)\b/i;

const SENIORITY_WORDS: [RegExp, (typeof SENIORITY_LEVELS)[number]][] = [
  [/\b(?:principal|staff|distinguished)\b/i, "principal"],
  [/\b(?:lead|head|manager|director)\b/i, "lead"],
  [/\b(?:senior|sr\.?)\b/i, "senior"],
  [/\b(?:mid|intermediate)\b/i, "mid"],
  [/\b(?:junior|jr\.?|graduate|intern|entry)\b/i, "junior"],
];

const unique = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The title the CV leads with: its headline, else the latest role. */
function leadTitle(profile: MasterProfile): string {
  return (
    profile.basics.headline.trim() || profile.experience[0]?.title.trim() || ""
  );
}

/** The kind of role a title suggests, or "any" when it doesn't say. */
export function focusFromCv(profile: MasterProfile | null): WantedFocus {
  if (!profile) return "any";
  const focus = focusFromTitle(leadTitle(profile));
  return focus === "other" ? "any" : focus;
}

/** The seniority a title suggests, with the level next to it: "senior" also offers "lead". */
export function seniorityFromCv(
  profile: MasterProfile | null,
): (typeof SENIORITY_LEVELS)[number][] {
  if (!profile) return [];
  const title = leadTitle(profile);
  const match = SENIORITY_WORDS.find(([pattern]) => pattern.test(title));
  if (!match) return [];
  const at = SENIORITY_LEVELS.indexOf(match[1]);
  const next = SENIORITY_LEVELS[at + 1];
  return next && match[1] !== "junior" ? [match[1], next] : [match[1]];
}

/** The country at the end of the CV's location, such as "Portugal" in "Lisbon, Portugal". */
export function countryFromCv(profile: MasterProfile | null): string[] {
  const parts = (profile?.basics.location ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const country = parts.at(-1);
  // "Remote" or "Worldwide" say nothing about where the owner can work.
  return country && !/^(?:remote|worldwide|anywhere)$/i.test(country)
    ? [country]
    : [];
}

/** The skills worth searching for: everything but people skills, in the CV's order. */
export function stackFromCv(profile: MasterProfile | null): string[] {
  if (!profile) return [];
  return unique(
    profile.skills
      .filter((skill) => !NOT_STACK.test(skill.category))
      .map((skill) => skill.name.trim()),
  ).slice(0, STACK_CHOICES);
}

/**
 * The answers to start the questions with: the saved preferences when there
 * are any, else what the CV suggests, with the owner's saved time zone, if
 * any, as the time zone to work in. The setup page adds the browser's.
 */
export function startingAnswers(
  profile: MasterProfile | null,
  saved: Preferences | null,
  timeZone: string | null,
): WantedAnswers {
  if (saved) {
    return {
      roleFocus: saved.roleFocus,
      seniority: saved.seniority,
      countries: saved.countries,
      timeZones: saved.timeZones,
      stack: saved.stack,
    };
  }
  return {
    roleFocus: focusFromCv(profile),
    seniority: seniorityFromCv(profile),
    countries: countryFromCv(profile),
    timeZones: timeZone && timeZone !== "UTC" ? [timeZone] : [],
    stack: stackFromCv(profile),
  };
}

/**
 * The choices a question offers: what's picked first, then the rest of the
 * suggestions, each once.
 */
export function choicesFor(picked: string[], suggested: string[]): string[] {
  return unique([...picked, ...suggested]);
}

/**
 * A question's answer from the form: the ticked choices and whatever was
 * typed in its box, split at commas, each once.
 */
export function answerList(values: FormDataEntryValue[]): string[] {
  return unique(
    values
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim()),
  );
}

/** The job preferences with setup's answers in, remote only kept on. */
export function preferencesWith(
  base: Preferences,
  answers: WantedAnswers,
): Preferences {
  return { ...base, ...answers, remoteOnly: true };
}
