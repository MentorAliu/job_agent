// A built CV as it's drawn: the tailored CV's view, aimed at the target job
// title, with only the sections the owner kept.
import { cvView, type CvView } from "@/lib/documents/view";
import type { CvBuildRequest } from "@/lib/schemas/cv-builder";
import type { HeaderLink, MasterProfile } from "@/lib/schemas/profile";
import type { ClaimCheck, CvContent } from "@/lib/schemas/tailor";

export function builtCvView(
  content: CvContent,
  check: ClaimCheck | null,
  profile: MasterProfile,
  request: Pick<CvBuildRequest, "targetTitle" | "sections">,
  links?: readonly HeaderLink[],
): CvView {
  const view = cvView(content, check, profile, links);
  const keep = (section: CvBuildRequest["sections"][number]) =>
    request.sections.includes(section);
  return {
    ...view,
    headline: request.targetTitle,
    projects: keep("projects") ? view.projects : [],
    education: keep("education") ? view.education : [],
    certifications: keep("certifications") ? view.certifications : [],
    languages: keep("languages") ? view.languages : [],
  };
}

/** "Jordan Sample - CV - Senior Frontend Engineer.pdf", or ".docx". */
export function builtCvFilename(
  name: string,
  targetTitle: string,
  extension: "pdf" | "docx" = "pdf",
): string {
  const parts = [name, "CV", targetTitle]
    .map((part) =>
      part
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return `${parts.join(" - ")}.${extension}`;
}
