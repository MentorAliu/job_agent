import type { CvLength, CvSection } from "@/lib/schemas/cv-builder";
import type { CvTemplate } from "@/lib/schemas/cv-template";

// How the builder's choices read, on its form and on each CV's page.

export const LENGTH_LABELS: Record<
  CvLength,
  { title: string; description: string }
> = {
  one_page: {
    title: "One page",
    description: "The usual for up to 10 years. Older roles get fewer lines.",
  },
  two_pages: {
    title: "Up to two pages",
    description: "Room for a long career, with more lines for recent roles.",
  },
};

export const SECTION_LABELS: Record<CvSection, string> = {
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  languages: "Languages",
};

export const TEMPLATE_LABELS: Record<
  CvTemplate,
  { title: string; description: string }
> = {
  modern: {
    title: "Modern",
    description: "A dark header band, teal accents and Inter type.",
  },
  classic: {
    title: "Classic",
    description: "Helvetica with blue headings: the app's first design.",
  },
  executive: {
    title: "Executive",
    description: "A serif, a centered header and burgundy headings.",
  },
  minimal: {
    title: "Minimal",
    description: "Clean type, indigo headings and plenty of white space.",
  },
};
