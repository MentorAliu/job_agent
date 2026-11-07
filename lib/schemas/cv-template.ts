// The designs a CV can be drawn in. Every one is a single column of real
// text, in reading order, with standard section names, so an applicant
// tracking system reads each the same way. They differ only in type, color
// and how the header and headings look.
import { z } from "zod";

export const CV_TEMPLATES = [
  "modern",
  "classic",
  "executive",
  "minimal",
] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];

export const cvTemplateSchema = z.enum(CV_TEMPLATES, {
  error: "Pick a design.",
});

/** New CVs and apply kits use it until the owner picks another in Settings. */
export const DEFAULT_CV_TEMPLATE: CvTemplate = "modern";

/**
 * The design a CV saved before designs existed was drawn in, so redrawing
 * or exporting it keeps its look.
 */
export const LEGACY_CV_TEMPLATE: CvTemplate = "classic";

export function isCvTemplate(value: unknown): value is CvTemplate {
  return (CV_TEMPLATES as readonly unknown[]).includes(value);
}
