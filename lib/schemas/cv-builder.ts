// The CV builder: what the owner asks for in its form, what Claude writes
// back, and how a built CV is stored in `built_cv`. The same schemas check
// the form in the browser, the Server Action and Claude's structured output.
import { z } from "zod";

import { cvTemplateSchema, type CvTemplate } from "./cv-template";
import { CV_SECTIONS, tailorOutputSchema } from "./tailor";

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export const CV_LENGTHS = ["one_page", "two_pages"] as const;
export type CvLength = (typeof CV_LENGTHS)[number];

/** The most pages each length may run to. */
export const CV_LENGTH_PAGES: Record<CvLength, number> = {
  one_page: 1,
  two_pages: 2,
};

export { CV_SECTIONS, type CvSection } from "./tailor";

export const TARGET_TITLE_MAX = 120;
export const JOB_TEXT_MAX = 12_000;
export const CV_NOTE_MAX = 500;
export const LEAD_SKILLS_MAX = 12;

export const cvBuildFormSchema = z.object({
  targetTitle: z
    .string()
    .trim()
    .min(1, "Enter the job title this CV aims at.")
    .max(TARGET_TITLE_MAX, `Use at most ${TARGET_TITLE_MAX} characters.`),
  jobText: z
    .string()
    .trim()
    .max(
      JOB_TEXT_MAX,
      `Keep the posting under ${JOB_TEXT_MAX.toLocaleString("en")} characters.`,
    ),
  skills: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Remove the empty entry.")
        .max(60, "Use at most 60 characters."),
    )
    .max(LEAD_SKILLS_MAX, `Pick at most ${LEAD_SKILLS_MAX} skills.`),
  length: z.enum(CV_LENGTHS),
  sections: z
    .array(z.enum(CV_SECTIONS))
    .refine(
      (sections) => new Set(sections).size === sections.length,
      "Pick each section once.",
    ),
  note: z
    .string()
    .trim()
    .max(CV_NOTE_MAX, `Keep the note under ${CV_NOTE_MAX} characters.`),
  template: cvTemplateSchema,
});

export type CvBuildForm = z.infer<typeof cvBuildFormSchema>;

/** Drawing a ready CV again in another design. */
export const cvRedrawSchema = z.object({
  id: z.uuid(),
  template: cvTemplateSchema,
});

/**
 * What a built CV was asked for, as stored on its row. The skills are the
 * profile's own skill ids, so the CV cites them like any other fact. CVs
 * saved before designs existed have no template: they're drawn in Classic.
 */
export type CvBuildRequest = Omit<CvBuildForm, "skills" | "template"> & {
  skillIds: string[];
  template?: CvTemplate;
};

// ---------------------------------------------------------------------------
// What Claude returns
// ---------------------------------------------------------------------------

// The tailored CV's shape, so the same citation check turns it into stored
// content, plus the posting's keywords for the ATS check.
export const cvBuildOutputSchema = tailorOutputSchema.shape.cv.extend({
  jobKeywords: z
    .array(z.string())
    .describe(
      "The skills, tools, methods and qualifications the job posting asks for, each in the posting's own words, most important first. At most 20. Empty when no posting is given.",
    ),
});

export type CvBuildOutput = z.infer<typeof cvBuildOutputSchema>;

/** At most this many posting keywords are kept. */
export const MAX_JOB_KEYWORDS = 20;

// ---------------------------------------------------------------------------
// A built CV's progress
// ---------------------------------------------------------------------------

/** Matches the `built_cv_status` enum. */
export const BUILT_CV_STATUSES = [
  "writing",
  "checking",
  "rendering",
  "ready",
  "failed",
] as const;
export type BuiltCvStatus = (typeof BUILT_CV_STATUSES)[number];

/** A build still going after this long never finishes. */
const LOST_MS = 30 * 60 * 1000;

export const LOST_BUILD_MESSAGE =
  "This CV never finished: the Inngest server stopped or couldn't reach the app. Build it again.";

/**
 * A build's progress as these checks read it. `updatedAt` moves with every
 * step, and when a ready CV is drawn again in another design, so a CV made
 * long ago and drawn again now isn't taken for a lost build.
 */
type BuildProgress = {
  status: BuiltCvStatus;
  createdAt: string | Date;
  updatedAt?: string | Date;
};

/** Whether the build is still going, so its page keeps checking on it. */
export function isBuildActive(
  build: BuildProgress,
  now = Date.now(),
): boolean {
  return (
    build.status !== "ready" &&
    build.status !== "failed" &&
    now - new Date(build.updatedAt ?? build.createdAt).getTime() < LOST_MS
  );
}

/** The status to show: a build that will never finish reads as failed. */
export function shownBuildStatus(
  build: BuildProgress,
  now = Date.now(),
): BuiltCvStatus {
  return build.status === "ready" ||
    build.status === "failed" ||
    isBuildActive(build, now)
    ? build.status
    : "failed";
}
