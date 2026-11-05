// The master profile, job preferences and standard answers. The same schemas
// check the review form in the browser, the Server Actions, and the jsonb
// columns in `profile` and `profile_snapshot`. `cvExtractionSchema` is what
// Claude returns when it reads a CV (step 1 of the pipeline).
import { z } from "zod";

// ---------------------------------------------------------------------------
// Fact ids
// ---------------------------------------------------------------------------

/**
 * Every fact in the profile (a role, a bullet, a skill…) has a stable id, so a
 * tailored document can cite the facts each of its bullets comes from.
 * Format: a short prefix, `_`, then 8 lowercase letters or digits.
 */
export const factIdSchema = z
  .string()
  .regex(/^[a-z]+_[a-z0-9]{8}$/, "Invalid fact id.");

export type FactPrefix =
  | "basics"
  | "link"
  | "role"
  | "proj"
  | "hl"
  | "skill"
  | "edu"
  | "cert"
  | "lang"
  | "qa";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A new random fact id. Uses `crypto.getRandomValues`, which works in the
 * browser over plain http too, unlike `crypto.randomUUID`.
 */
export function newFactId(prefix: FactPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const byte of bytes) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}_${suffix}`;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

const text = (max: number) =>
  z.string().trim().max(max, `Use at most ${max} characters.`);
const requiredText = (max: number, message: string) =>
  text(max).min(1, message);

/** A date as precise as the CV gives it: `YYYY`, `YYYY-MM`, or empty. */
export const partialDateSchema = z
  .string()
  .trim()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?)?$/, "Use YYYY or YYYY-MM.");

/** An http(s) URL, or empty. */
const optionalUrl = z.union([
  z.literal(""),
  z.url({
    protocol: /^https?$/,
    hostname: z.regexes.domain,
    error: "Enter a full URL starting with https://.",
  }),
]);

const tags = (max: number) =>
  z
    .array(requiredText(100, "Remove the empty entry."))
    .max(max, `Add at most ${max} entries.`);

/** Rejects an end date before the start date. Partial dates compare as text. */
function checkDateOrder(
  value: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
) {
  const { startDate, endDate } = value;
  // A badly formatted date already has its own error.
  const valid = (date: string) =>
    date !== "" && partialDateSchema.safeParse(date).success;
  if (valid(startDate) && valid(endDate) && endDate < startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date is before the start date.",
    });
  }
}

// ---------------------------------------------------------------------------
// Master profile
// ---------------------------------------------------------------------------

export const highlightSchema = z.object({
  id: factIdSchema,
  text: requiredText(1000, "Write the bullet or remove it."),
});

export const linkSchema = z.object({
  id: factIdSchema,
  label: requiredText(100, "Name the link, for example GitHub."),
  url: optionalUrl.refine((url) => url !== "", "Enter the link's URL."),
});

export const roleSchema = z
  .object({
    id: factIdSchema,
    title: requiredText(200, "Enter the job title."),
    company: requiredText(200, "Enter the company."),
    location: text(200),
    startDate: partialDateSchema,
    endDate: partialDateSchema,
    current: z.boolean(),
    summary: text(2000),
    highlights: z.array(highlightSchema).max(40),
    technologies: tags(40),
  })
  .superRefine(checkDateOrder);

export const projectSchema = z
  .object({
    id: factIdSchema,
    name: requiredText(200, "Enter the project name."),
    role: text(200),
    url: optionalUrl,
    startDate: partialDateSchema,
    endDate: partialDateSchema,
    summary: text(2000),
    highlights: z.array(highlightSchema).max(40),
    technologies: tags(40),
  })
  .superRefine(checkDateOrder);

export const skillSchema = z.object({
  id: factIdSchema,
  name: requiredText(100, "Enter the skill or remove it."),
  category: text(100),
});

export const educationSchema = z
  .object({
    id: factIdSchema,
    institution: requiredText(200, "Enter the school or university."),
    degree: text(200),
    field: text(200),
    startDate: partialDateSchema,
    endDate: partialDateSchema,
    details: text(2000),
  })
  .superRefine(checkDateOrder);

export const certificationSchema = z.object({
  id: factIdSchema,
  name: requiredText(200, "Enter the certification."),
  issuer: text(200),
  date: partialDateSchema,
  url: optionalUrl,
});

export const languageSchema = z.object({
  id: factIdSchema,
  name: requiredText(100, "Enter the language."),
  level: text(100),
});

// The headline and summary make claims ("7 years of experience"), so the
// basics carry a fact id that tailored text can cite.
export const basicsSchema = z.object({
  id: factIdSchema,
  name: requiredText(200, "Enter your name."),
  headline: text(200),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
  phone: text(50),
  location: text(200),
  summary: text(4000),
});

export const masterProfileSchema = z
  .object({
    basics: basicsSchema,
    links: z.array(linkSchema).max(20),
    experience: z.array(roleSchema).max(50),
    projects: z.array(projectSchema).max(50),
    skills: z.array(skillSchema).max(200),
    education: z.array(educationSchema).max(20),
    certifications: z.array(certificationSchema).max(50),
    languages: z.array(languageSchema).max(20),
  })
  .superRefine((profile, ctx) => {
    // Fact ids must be unique across the whole profile, or citations would be
    // ambiguous. The form never shows ids, so report it on the profile.
    const seen = new Set<string>();
    for (const id of factIds(profile)) {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate fact id ${id}.` });
        return;
      }
      seen.add(id);
    }
  });

export type MasterProfile = z.infer<typeof masterProfileSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Project = z.infer<typeof projectSchema>;

/** Every fact id in a profile, in document order. */
export function factIds(profile: MasterProfile): string[] {
  const withHighlights = (
    items: { id: string; highlights: { id: string }[] }[],
  ) => items.flatMap((item) => [item.id, ...item.highlights.map((h) => h.id)]);
  return [
    profile.basics.id,
    ...profile.links.map((link) => link.id),
    ...withHighlights(profile.experience),
    ...withHighlights(profile.projects),
    ...profile.skills.map((skill) => skill.id),
    ...profile.education.map((entry) => entry.id),
    ...profile.certifications.map((cert) => cert.id),
    ...profile.languages.map((language) => language.id),
  ];
}

export function emptyMasterProfile(): MasterProfile {
  return {
    basics: {
      id: newFactId("basics"),
      name: "",
      headline: "",
      email: "",
      phone: "",
      location: "",
      summary: "",
    },
    links: [],
    experience: [],
    projects: [],
    skills: [],
    education: [],
    certifications: [],
    languages: [],
  };
}

// ---------------------------------------------------------------------------
// What Claude returns when it reads a CV
// ---------------------------------------------------------------------------

// Every field is required and plain, with no ids: structured outputs limit
// optional and union-typed fields, and a strict check here would fail the
// whole parse over one odd date. `toMasterProfile` adds ids and tidies values,
// and the review form shows whatever still doesn't pass `masterProfileSchema`.
const DATE_HINT =
  'As "YYYY-MM", or "YYYY" when the CV gives only the year. Empty string when the CV gives no date.';
const EMPTY_HINT = "Empty string when the CV doesn't say.";

export const cvExtractionSchema = z.object({
  basics: z.object({
    name: z.string(),
    headline: z
      .string()
      .describe(
        `The professional title the CV uses, such as "Senior Frontend Engineer". ${EMPTY_HINT}`,
      ),
    email: z.string().describe(EMPTY_HINT),
    phone: z.string().describe(EMPTY_HINT),
    location: z.string().describe(`City and country. ${EMPTY_HINT}`),
    summary: z
      .string()
      .describe(
        `The CV's own profile or summary paragraph, verbatim. ${EMPTY_HINT}`,
      ),
  }),
  links: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .describe("Every link: LinkedIn, GitHub, portfolio, website and so on."),
  experience: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        location: z.string().describe(EMPTY_HINT),
        startDate: z.string().describe(DATE_HINT),
        endDate: z
          .string()
          .describe(`${DATE_HINT} Empty string for a current role.`),
        current: z
          .boolean()
          .describe("True when the CV says the role is ongoing."),
        summary: z
          .string()
          .describe(
            `A short description of the role that isn't a bullet. ${EMPTY_HINT}`,
          ),
        highlights: z
          .array(z.string())
          .describe("Each bullet point, in the CV's own words."),
        technologies: z
          .array(z.string())
          .describe("Technologies the CV names for this role."),
      }),
    )
    .describe(
      "Every job, internship and freelance engagement, most recent first.",
    ),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().describe(EMPTY_HINT),
        url: z.string().describe(EMPTY_HINT),
        startDate: z.string().describe(DATE_HINT),
        endDate: z.string().describe(DATE_HINT),
        summary: z.string().describe(EMPTY_HINT),
        highlights: z
          .array(z.string())
          .describe("Each bullet point, in the CV's own words."),
        technologies: z.array(z.string()),
      }),
    )
    .describe(
      "Every project listed outside the jobs: personal, open source, academic.",
    ),
  skills: z
    .array(
      z.object({
        name: z
          .string()
          .describe("One skill, such as TypeScript or PostgreSQL."),
        category: z
          .string()
          .describe(
            "The CV's heading for it, or a short category such as Languages, Frameworks, Databases, Cloud, Tools.",
          ),
      }),
    )
    .describe("Every skill the CV lists, one entry each."),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().describe(EMPTY_HINT),
      field: z.string().describe(EMPTY_HINT),
      startDate: z.string().describe(DATE_HINT),
      endDate: z.string().describe(DATE_HINT),
      details: z.string().describe(`Grades, thesis or honours. ${EMPTY_HINT}`),
    }),
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().describe(EMPTY_HINT),
      date: z.string().describe(DATE_HINT),
      url: z.string().describe(EMPTY_HINT),
    }),
  ),
  languages: z
    .array(
      z.object({
        name: z.string(),
        level: z
          .string()
          .describe(`Such as Native, Fluent or C1. ${EMPTY_HINT}`),
      }),
    )
    .describe("Spoken languages, not programming languages."),
});

export type CvExtraction = z.infer<typeof cvExtractionSchema>;

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const PRESENT = /^(present|current|now|today|ongoing)$/i;

/**
 * Best-effort conversion of a CV date to `YYYY` or `YYYY-MM`. Unknown formats
 * are kept as they are, so the review form flags them instead of losing them.
 */
export function normalizePartialDate(value: string): string {
  const input = value.trim();
  if (input === "" || PRESENT.test(input)) return "";
  if (partialDateSchema.safeParse(input).success) return input;

  let match = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(input);
  if (match) return withMonth(match[1], match[2]);
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(input);
  if (match) return withMonth(match[2], match[1]);
  match = /^([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$/.exec(input);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) return `${match[2]}-${month}`;
  }
  return input;
}

function withMonth(year: string, month: string): string {
  const number = Number(month);
  if (number < 1 || number > 12) return `${year}-${month}`;
  return `${year}-${String(number).padStart(2, "0")}`;
}

/** Adds `https://` to a bare domain such as `github.com/jane`. */
export function normalizeUrl(value: string): string {
  const input = value.trim();
  if (input === "" || /^https?:\/\//i.test(input)) return input;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(input)) return `https://${input}`;
  return input;
}

const clean = (values: string[]) =>
  values.map((value) => value.trim()).filter((value) => value !== "");

/** Turns Claude's extraction into a master profile with a fresh id on every fact. */
export function toMasterProfile(cv: CvExtraction): MasterProfile {
  const highlights = (items: string[]) =>
    clean(items).map((text) => ({ id: newFactId("hl"), text }));

  return {
    basics: {
      id: newFactId("basics"),
      name: cv.basics.name.trim(),
      headline: cv.basics.headline.trim(),
      email: cv.basics.email.trim(),
      phone: cv.basics.phone.trim(),
      location: cv.basics.location.trim(),
      summary: cv.basics.summary.trim(),
    },
    links: cv.links
      .filter((link) => link.url.trim() !== "")
      .map((link) => ({
        id: newFactId("link"),
        label: link.label.trim() || link.url.trim(),
        url: normalizeUrl(link.url),
      })),
    experience: cv.experience.map((role) => {
      const ongoing = role.current || PRESENT.test(role.endDate.trim());
      return {
        id: newFactId("role"),
        title: role.title.trim(),
        company: role.company.trim(),
        location: role.location.trim(),
        startDate: normalizePartialDate(role.startDate),
        endDate: ongoing ? "" : normalizePartialDate(role.endDate),
        current: ongoing,
        summary: role.summary.trim(),
        highlights: highlights(role.highlights),
        technologies: clean(role.technologies),
      };
    }),
    projects: cv.projects.map((project) => ({
      id: newFactId("proj"),
      name: project.name.trim(),
      role: project.role.trim(),
      url: normalizeUrl(project.url),
      startDate: normalizePartialDate(project.startDate),
      endDate: normalizePartialDate(project.endDate),
      summary: project.summary.trim(),
      highlights: highlights(project.highlights),
      technologies: clean(project.technologies),
    })),
    skills: cv.skills
      .filter((skill) => skill.name.trim() !== "")
      .map((skill) => ({
        id: newFactId("skill"),
        name: skill.name.trim(),
        category: skill.category.trim(),
      })),
    education: cv.education.map((entry) => ({
      id: newFactId("edu"),
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      field: entry.field.trim(),
      startDate: normalizePartialDate(entry.startDate),
      endDate: normalizePartialDate(entry.endDate),
      details: entry.details.trim(),
    })),
    certifications: cv.certifications.map((cert) => ({
      id: newFactId("cert"),
      name: cert.name.trim(),
      issuer: cert.issuer.trim(),
      date: normalizePartialDate(cert.date),
      url: normalizeUrl(cert.url),
    })),
    languages: cv.languages.map((language) => ({
      id: newFactId("lang"),
      name: language.name.trim(),
      level: language.level.trim(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Job preferences
// ---------------------------------------------------------------------------

export const SENIORITY_LEVELS = [
  "junior",
  "mid",
  "senior",
  "lead",
  "principal",
] as const;

export const SALARY_PERIODS = ["year", "month", "hour"] as const;

/**
 * The kind of role the candidate wants most. Those roles come first in
 * searches, scores and kits, whatever framework or language they use. "any"
 * puts none ahead. Matches RoleFocus in job.ts, without "other".
 */
export const WANTED_FOCUS = [
  "any",
  "frontend",
  "fullstack",
  "backend",
  "mobile",
] as const;
export type WantedFocus = (typeof WANTED_FOCUS)[number];

/** An IANA time zone name such as `Europe/Lisbon`. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const preferencesSchema = z.object({
  remoteOnly: z.boolean(),
  countries: tags(50).min(1, "Add at least one country you can work from."),
  timeZones: z
    .array(
      z
        .string()
        .trim()
        .refine(isTimeZone, "Use a time zone name such as Europe/Lisbon."),
    )
    .min(1, "Add at least one time zone you can work in.")
    .max(20, "Add at most 20 time zones."),
  seniority: z.array(z.enum(SENIORITY_LEVELS)),
  roleFocus: z.enum(WANTED_FOCUS),
  stack: tags(50),
  salaryFloor: z.object({
    amount: z
      .number({ error: "Enter a number." })
      .int("Use a whole number.")
      .nonnegative("Use a positive number.")
      .nullable(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as EUR."),
    period: z.enum(SALARY_PERIODS),
  }),
  excludedCompanies: tags(200),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const defaultPreferences: Preferences = {
  remoteOnly: true,
  countries: [],
  timeZones: [],
  seniority: [],
  roleFocus: "any",
  stack: [],
  salaryFloor: { amount: null, currency: "EUR", period: "year" },
  excludedCompanies: [],
};

// ---------------------------------------------------------------------------
// Standard answers for application forms
// ---------------------------------------------------------------------------

export const answersSchema = z.object({
  noticePeriod: text(200),
  workAuthorization: text(1000),
  links: z.object({
    linkedin: optionalUrl,
    github: optionalUrl,
    portfolio: optionalUrl,
  }),
  extra: z
    .array(
      z.object({
        id: factIdSchema,
        question: requiredText(300, "Write the question or remove it."),
        answer: requiredText(4000, "Write the answer or remove it."),
      }),
    )
    .max(50),
});

export type Answers = z.infer<typeof answersSchema>;

/** A question as saved answers are matched on: case and spacing ignored. */
export function questionKey(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

/** An answer the owner gives in the apply kit, saved to their standard answers. */
export const savedAnswerSchema = z.object({
  question: requiredText(300, "The question is missing."),
  answer: requiredText(4000, "Write your answer first."),
});
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;

export const defaultAnswers: Answers = {
  noticePeriod: "",
  workAuthorization: "",
  links: { linkedin: "", github: "", portfolio: "" },
  extra: [],
};

/** The links the standard answers keep, and how a profile link of that kind is named. */
const STANDARD_LINKS = [
  { kind: "linkedin", label: "LinkedIn", pattern: /linkedin/i },
  { kind: "github", label: "GitHub", pattern: /github/i },
  { kind: "portfolio", label: "Portfolio", pattern: /portfolio|website|site/i },
] as const;

export type StandardLinkKind = (typeof STANDARD_LINKS)[number]["kind"];

/** A link at the top of a CV or cover letter. */
export type HeaderLink = { label: string; url: string };

export type OwnerLink = HeaderLink & { kind: StandardLinkKind | null };

/** Its name decides first, so a "Portfolio" on github.io stays a portfolio. */
function linkKind(label: string, url: string): StandardLinkKind | null {
  const match =
    STANDARD_LINKS.find(({ pattern }) => pattern.test(label)) ??
    STANDARD_LINKS.find(({ pattern }) => pattern.test(url));
  return match?.kind ?? null;
}

/** linkedin.com/in/jane/ and https://www.linkedin.com/in/jane are one link. */
const urlKey = (url: string) =>
  url
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/**
 * The owner's links, for the top of a CV or cover letter and for application
 * forms: the profile's, with the LinkedIn, GitHub and portfolio saved in the
 * standard answers in place of the profile's link of that kind, or after
 * them when the profile has none.
 */
export function ownerLinks(
  profileLinks: readonly { label: string; url: string }[],
  answers: Answers["links"] | null,
): OwnerLink[] {
  const links: OwnerLink[] = profileLinks.map(({ label, url }) => ({
    label,
    url,
    kind: linkKind(label, url),
  }));
  for (const { kind, label } of STANDARD_LINKS) {
    const url = answers?.[kind].trim();
    if (!url) continue;
    const index = links.findIndex((link) => link.kind === kind);
    if (index === -1) links.push({ label, url, kind });
    else links[index] = { ...links[index], url };
  }
  // The first of two links to one place is kept, and takes the other's kind
  // when it has none.
  const byUrl = new Map<string, OwnerLink>();
  for (const link of links) {
    const earlier = byUrl.get(urlKey(link.url));
    if (!earlier) byUrl.set(urlKey(link.url), link);
    else if (!earlier.kind) earlier.kind = link.kind;
  }
  return [...byUrl.values()];
}

/** The URL of the owner's link of that kind, or "" when they have none. */
export function ownerLink(links: OwnerLink[], kind: StandardLinkKind): string {
  return links.find((link) => link.kind === kind)?.url ?? "";
}
