// The ATS check on a CV, built or tailored: which of the posting's keywords
// the CV uses, and, for the ones it doesn't, whether the profile has them at
// all. A keyword the profile lacks can only reach the CV once the owner adds
// it to the profile, since a CV never says what the profile doesn't.
import type { CvView } from "@/lib/documents/view";
import { MAX_JOB_KEYWORDS } from "@/lib/schemas/cv-builder";
import type { JobFacts } from "@/lib/schemas/job";
import type { MasterProfile } from "@/lib/schemas/profile";
import { profileFacts } from "@/lib/tailor/facts";

export type KeywordMatch = {
  term: string;
  /** The CV uses the term. */
  onCv: boolean;
  /** The term is somewhere in the profile, whether or not the CV uses it. */
  inProfile: boolean;
};

function words(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9+#]+/g, " ")
    .trim();
}

/**
 * Lowercase words with spaces around them, so a term matches whole words
 * only: "Java" doesn't match "JavaScript", while "C#" and "C++" keep their
 * symbols.
 */
export function normalizeForMatch(text: string): string {
  return ` ${words(text).toLowerCase()} `;
}

/** A text to look for terms in, with and without its case. */
type Haystack = { lower: string; cased: string };

function haystack(text: string): Haystack {
  return { lower: normalizeForMatch(text), cased: ` ${words(text)} ` };
}

/**
 * Short names such as "Go", "R" or "REST" are everyday words too, so they
 * match only as written: "go" or "rest" in a sentence don't count.
 */
function caseMatters(term: string): boolean {
  return /^[A-Za-z]{1,4}$/.test(term.trim());
}

/**
 * "React.js" and "ReactJS" are matched as "React" too. Short names keep
 * their "js", so "Next.js" never matches the word "next".
 */
function variants(term: string): string[] {
  const normal = normalizeForMatch(term).trim();
  if (normal === "") return [];
  const base = normal.replace(/ ?js$/, "").trim();
  return base.length >= 5 && base !== normal ? [normal, base] : [normal];
}

function contains(text: Haystack, term: string): boolean {
  if (caseMatters(term)) return text.cased.includes(` ${term.trim()} `);
  return variants(term).some((variant) => text.lower.includes(` ${variant} `));
}

/** The same key for "React", "react" and "React.js", so each is listed once. */
function termKey(term: string): string {
  return variants(term).at(-1) ?? "";
}

/** Each term once, in order, without empty ones. */
function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.flatMap((raw) => {
    const term = raw.trim();
    const key = termKey(term);
    if (key === "" || seen.has(key)) return [];
    seen.add(key);
    return [term];
  });
}

/** Everything the CV says, as one text. */
export function cvText(view: CvView): string {
  return [
    view.headline,
    view.summary ?? "",
    ...view.skills,
    ...view.experience.flatMap((role) => [
      role.title,
      role.company,
      ...role.highlights,
      ...role.technologies,
    ]),
    ...view.projects.flatMap((project) => [
      project.name,
      project.role,
      ...project.highlights,
    ]),
    ...view.education.flatMap((entry) => [
      entry.title,
      entry.institution,
      entry.details,
    ]),
    ...view.certifications,
    ...view.languages,
  ].join("\n");
}

/**
 * Everything the profile states, as one text. Preferences and saved answers
 * stay out: a stack the owner would like to work in isn't one they know.
 */
export function profileText(profile: MasterProfile): string {
  return profileFacts(profile, null)
    .map((fact) => fact.text)
    .join("\n");
}

/** Each keyword, once, with where it shows up. */
export function keywordCoverage(
  keywords: string[],
  cv: string,
  profile: string,
): KeywordMatch[] {
  const onCv = haystack(cv);
  const inProfile = haystack(profile);
  return uniqueTerms(keywords).map((term) => {
    const used = contains(onCv, term);
    return { term, onCv: used, inProfile: used || contains(inProfile, term) };
  });
}

/** A role's posting, as its keywords are picked from it. */
export type KeywordPosting = {
  title: string;
  facts: JobFacts | null;
  description: string | null;
};

/**
 * A role's keywords for its tailored CV, picked without a Claude call: the
 * tools the posting names, as read with its facts, then the profile's own
 * skills and technologies that the posting mentions anywhere, which that
 * reading may have left out.
 */
export function postingKeywords(
  posting: KeywordPosting,
  profile: MasterProfile,
): string[] {
  const stack = posting.facts?.stack ?? [];
  const text = haystack(
    [
      posting.title,
      posting.facts?.summary ?? "",
      ...(posting.facts?.requirements ?? []),
      ...stack,
      posting.description ?? "",
    ].join("\n"),
  );
  const own = [
    ...profile.skills.map((skill) => skill.name),
    ...profile.experience.flatMap((role) => role.technologies),
    ...profile.projects.flatMap((project) => project.technologies),
  ].filter((term) => contains(text, term));
  return uniqueTerms([...stack, ...own]).slice(0, MAX_JOB_KEYWORDS);
}

/**
 * The profile's skills that name a keyword the profile has and the CV
 * doesn't use: adding them to the CV's skills puts those keywords on it.
 * Skills the CV lists already are left out.
 */
export function skillsForKeywords(
  keywords: KeywordMatch[],
  profile: MasterProfile,
  onCv: string[],
): { id: string; name: string }[] {
  const missing = keywords
    .filter((keyword) => keyword.inProfile && !keyword.onCv)
    .map((keyword) => keyword.term);
  const shown = new Set(onCv);
  return profile.skills
    .filter(
      (skill) =>
        !shown.has(skill.id) &&
        missing.some((term) => contains(haystack(skill.name), term)),
    )
    .map(({ id, name }) => ({ id, name }));
}

/** The keywords the profile states, which the CV can use. */
export function backedKeywords(
  keywords: string[],
  profile: MasterProfile,
): string[] {
  return keywordCoverage(keywords, "", profileText(profile))
    .filter((keyword) => keyword.inProfile)
    .map((keyword) => keyword.term);
}
