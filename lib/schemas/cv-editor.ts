// The CV editor: the owner makes a new CV from an earlier one, or from the
// whole profile, by keeping, adding and removing lines. A line is sent as a
// reference to text the CV or the profile already holds, never as text, so
// every line on an edited CV comes from the profile. Only the title and the
// summary are typed. The same schemas check the editor in the browser and
// its Server Action.
import { z } from "zod";

import { CV_LENGTHS, TARGET_TITLE_MAX } from "./cv-builder";
import { cvTemplateSchema } from "./cv-template";
import { factIdSchema } from "./profile";

/** Where an edit starts. */
export const cvEditSourceSchema = z.discriminatedUnion("kind", [
  /** Everything in the profile: the uploaded CV, as the app read it. */
  z.object({ kind: z.literal("profile") }),
  /** A CV on the General tab. */
  z.object({ kind: z.literal("built"), id: z.uuid() }),
  /** A tailored CV in a role's apply kit, by its document's id. */
  z.object({ kind: z.literal("kit"), id: z.uuid() }),
]);
export type CvEditSource = z.infer<typeof cvEditSourceSchema>;

/** Sections shown whole or not at all. Projects are kept one by one. */
export const EDITOR_SECTIONS = [
  "education",
  "certifications",
  "languages",
] as const;
export type EditorSection = (typeof EDITOR_SECTIONS)[number];

export const SUMMARY_MAX = 4000;
export const EDIT_SKILLS_MAX = 40;
const LINES_MAX = 40;

/**
 * `cv:<item id>` is a line of the CV being edited, in its own wording;
 * `fact:<highlight id>` is a bullet from the profile, as the profile has it.
 */
export const lineRefSchema = z
  .string()
  .regex(/^(cv|fact):[\w:-]{1,120}$/, "This line isn't one the editor knows.");

const lines = z
  .array(z.object({ ref: lineRefSchema }))
  .max(LINES_MAX, `Keep at most ${LINES_MAX} lines.`);

export const cvEditFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Enter the title shown under your name.")
    .max(TARGET_TITLE_MAX, `Use at most ${TARGET_TITLE_MAX} characters.`),
  summary: z
    .string()
    .trim()
    .max(SUMMARY_MAX, `Keep the summary under ${SUMMARY_MAX} characters.`),
  skillIds: z
    .array(factIdSchema)
    .max(EDIT_SKILLS_MAX, `Keep at most ${EDIT_SKILLS_MAX} skills.`),
  /** Every role in the profile, in its order. */
  experience: z.array(
    z.object({ roleId: factIdSchema, shown: z.boolean(), lines }),
  ),
  /** Every project in the profile, in its order. */
  projects: z.array(
    z.object({ projectId: factIdSchema, shown: z.boolean(), lines }),
  ),
  sections: z
    .array(z.enum(EDITOR_SECTIONS))
    .refine(
      (sections) => new Set(sections).size === sections.length,
      "Pick each section once.",
    ),
  length: z.enum(CV_LENGTHS),
  template: cvTemplateSchema,
});

export type CvEditForm = z.infer<typeof cvEditFormSchema>;

/**
 * Profile skills to add to a role's tailored CV, picked from its ATS
 * keywords, by the CV's document id.
 */
export const addCvSkillsSchema = z.object({
  documentId: z.uuid(),
  skillIds: z.array(factIdSchema).min(1).max(EDIT_SKILLS_MAX),
});
export type AddCvSkills = z.infer<typeof addCvSkillsSchema>;
