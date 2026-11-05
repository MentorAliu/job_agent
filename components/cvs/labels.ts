import type { CvLength, CvSection } from "@/lib/schemas/cv-builder";

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
