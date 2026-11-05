// The form filler: the Chrome extension reads an application form's fields,
// the app says what goes in each, and the extension fills them. The owner
// checks the form and presses Submit; the extension never does.
import { z } from "zod";

import type { FormQuestion } from "./tailor";

export const FORM_FIELD_KINDS = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
  "radio",
  "file",
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

/** One field of the form, as the extension reads it from the page. */
export const formFieldSchema = z.object({
  /** The extension's own handle for the field on the page. */
  key: z.string().min(1).max(40),
  kind: z.enum(FORM_FIELD_KINDS),
  /** The field's label or question, as the page words it. */
  label: z.string().trim().max(1000),
  name: z.string().trim().max(200),
  /** The page's autocomplete hint, such as "given-name". */
  autocomplete: z.string().trim().max(100),
  /** A select's or radio group's choices. */
  options: z.array(z.string().trim().max(300)).max(100),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const MAX_FORM_FIELDS = 150;

/** At most this many of a form's questions go to Claude in one request. */
export const MAX_FORM_QUESTIONS = 15;

export const fillRequestSchema = z.object({
  jobId: z.uuid(),
  fields: z.array(formFieldSchema).max(MAX_FORM_FIELDS),
});
export type FillRequest = z.infer<typeof fillRequestSchema>;

export const jobIdSchema = z.object({ jobId: z.uuid() });

/** The address of the page the extension is on. */
export const pageUrlSchema = z.object({ url: z.string().max(4096) });

/** Which tailored PDF goes in a file field. */
export type FillFileKind = "cv" | "cover_letter";

/** What goes where, from the profile and the apply kit. */
export type FillPlan = {
  values: { key: string; value: string }[];
  files: { key: string; kind: FillFileKind }[];
  /** Questions nothing answers yet, for Claude to answer from the profile. */
  questions: (FormQuestion & { key: string })[];
  /**
   * What to ask Claude when any question is unanswered: those questions and
   * the ones a tailored answer covers, so new answers cover the whole form.
   */
  asked: (FormQuestion & { key: string })[];
  /** Fields left for the owner: personal or demographic ones, and the unknown. */
  left: string[];
};
