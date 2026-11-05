// The CV editor's logic: what it opens with, from an earlier CV or from the
// whole profile, and the CV it saves. Each line the owner keeps is looked up
// again from the CV or the profile it refers to, so an edited CV holds only
// lines that are already there, and each still cites its profile facts.
import { formatDateRange, cvView, type CvView } from "@/lib/documents/view";
import type { CvLength } from "@/lib/schemas/cv-builder";
import {
  EDIT_SKILLS_MAX,
  EDITOR_SECTIONS,
  type CvEditForm,
  type EditorSection,
} from "@/lib/schemas/cv-editor";
import type { MasterProfile } from "@/lib/schemas/profile";
import {
  CV_SECTIONS,
  type CitedText,
  type ClaimCheck,
  type ClaimFlag,
  type CvContent,
  type CvSection,
} from "@/lib/schemas/tailor";
import { citationProblem, flaggedIds } from "@/lib/tailor/citations";
import { factIndex, profileFacts, type Fact } from "@/lib/tailor/facts";

/** One line the editor can show under a role or project. */
export type EditorLine = {
  ref: string;
  text: string;
  /** The profile facts it comes from. */
  sources: string[];
  /** In the CV's own wording, or the profile's. */
  from: "cv" | "profile";
};

/** A role or project, with every line it can show. */
export type EditorEntry = {
  id: string;
  title: string;
  dates: string;
  /** The CV's lines first, then the profile's bullets it doesn't reword. */
  lines: EditorLine[];
};

/** Everything the editor can put on the CV. */
export type EditorCatalogue = {
  roles: EditorEntry[];
  projects: EditorEntry[];
  skills: { id: string; name: string }[];
  /** The sections shown whole, as the CV prints them. */
  sections: {
    education: CvView["education"];
    certifications: string[];
    languages: string[];
  };
};

/** A CV to edit, with what was chosen for it. */
export type EditFrom = {
  content: CvContent;
  check: ClaimCheck | null;
  title: string;
  /** Null when every section the profile has is shown. */
  sections: CvSection[] | null;
  /** Null for a CV that isn't fitted to a length, such as a kit's. */
  length: CvLength | null;
};

/** The owner's edit can't be saved as sent. */
export class CvEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvEditError";
  }
}

const STALE_MESSAGE =
  "Part of this CV isn't in your profile anymore. Reload the page and try again.";

/** Long careers get two pages; short ones read better on one. */
const TWO_PAGES_FROM_ROLES = 4;

const sameText = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

type Entry = {
  id: string;
  title: string;
  dates: string;
  label: string;
  highlights: { id: string; text: string }[];
};

function profileEntries(profile: MasterProfile) {
  const roles: Entry[] = profile.experience.map((role) => ({
    id: role.id,
    title: `${role.title}, ${role.company}`,
    dates: formatDateRange(role.startDate, role.endDate, role.current),
    label: `your role at ${role.company}`,
    highlights: role.highlights,
  }));
  const projects: Entry[] = profile.projects.map((project) => ({
    id: project.id,
    title: project.name,
    dates: formatDateRange(project.startDate, project.endDate),
    label: `the ${project.name} project`,
    highlights: project.highlights,
  }));
  return { roles, projects };
}

/**
 * The CV's own lines for each role and project: the ones it shows, whose
 * citations still hold against the profile as it is now.
 */
function cvLines(
  from: EditFrom | null,
  entries: Entry[],
  facts: Map<string, Fact>,
): Map<string, EditorLine[]> {
  const lines = new Map<string, EditorLine[]>();
  if (!from) return lines;
  const flagged = flaggedIds(from.check);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const { id, highlights } of [
    ...from.content.experience.map((e) => ({
      id: e.roleId,
      highlights: e.highlights,
    })),
    ...from.content.projects.map((p) => ({
      id: p.projectId,
      highlights: p.highlights,
    })),
  ]) {
    const entry = byId.get(id);
    if (!entry) continue;
    lines.set(
      id,
      highlights
        .filter(
          (item) =>
            !flagged.has(item.id) &&
            citationProblem(item, facts, { id, label: entry.label }) === null,
        )
        .map((item) => ({
          ref: `cv:${item.id}`,
          text: item.text,
          sources: item.sources,
          from: "cv" as const,
        })),
    );
  }
  return lines;
}

function catalogueEntry(entry: Entry, own: EditorLine[]): EditorEntry {
  // A profile bullet the CV kept word for word is offered once, as the CV's.
  const profileLines = entry.highlights
    .filter(
      (highlight) =>
        !own.some(
          (line) =>
            line.sources.includes(highlight.id) &&
            sameText(line.text, highlight.text),
        ),
    )
    .map((highlight) => ({
      ref: `fact:${highlight.id}`,
      text: highlight.text,
      sources: [highlight.id],
      from: "profile" as const,
    }));
  return {
    id: entry.id,
    title: entry.title,
    dates: entry.dates,
    lines: [...own, ...profileLines],
  };
}

/** The sections the profile has something for. */
function filledSections(profile: MasterProfile): EditorSection[] {
  return EDITOR_SECTIONS.filter((section) => profile[section].length > 0);
}

function defaultLength(profile: MasterProfile): CvLength {
  return profile.experience.length >= TWO_PAGES_FROM_ROLES
    ? "two_pages"
    : "one_page";
}

/** The summary the CV shows, when it shows one. */
function shownSummary(from: EditFrom | null): CitedText | null {
  const summary = from?.content.summary;
  if (!summary || flaggedIds(from.check).has(summary.id)) return null;
  return summary;
}

/**
 * What the editor can show and what it opens with. From a CV, it opens with
 * that CV's lines; from the profile alone, with everything in it, as the
 * uploaded CV had it.
 */
export function editorStart(
  profile: MasterProfile,
  from: EditFrom | null,
): { form: CvEditForm; catalogue: EditorCatalogue } {
  const facts = factIndex(profileFacts(profile, null));
  const { roles, projects } = profileEntries(profile);
  const own = cvLines(from, [...roles, ...projects], facts);
  const sections = cvView(
    { kind: "cv", summary: null, experience: [], projects: [], skillIds: [] },
    null,
    profile,
  );
  const catalogue: EditorCatalogue = {
    roles: roles.map((entry) => catalogueEntry(entry, own.get(entry.id) ?? [])),
    projects: projects.map((entry) =>
      catalogueEntry(entry, own.get(entry.id) ?? []),
    ),
    skills: profile.skills.map(({ id, name }) => ({ id, name })),
    sections: {
      education: sections.education,
      certifications: sections.certifications,
      languages: sections.languages,
    },
  };

  if (!from) {
    const everything = (entry: Entry) => ({
      shown: true,
      lines: entry.highlights.map((highlight) => ({
        ref: `fact:${highlight.id}`,
      })),
    });
    return {
      catalogue,
      form: {
        title:
          profile.basics.headline.trim() ||
          profile.experience[0]?.title.trim() ||
          "",
        summary: profile.basics.summary,
        skillIds: profile.skills
          .slice(0, EDIT_SKILLS_MAX)
          .map((skill) => skill.id),
        experience: roles.map((entry) => ({
          roleId: entry.id,
          ...everything(entry),
        })),
        projects: projects.map((entry) => ({
          projectId: entry.id,
          ...everything(entry),
        })),
        sections: filledSections(profile),
        length: defaultLength(profile),
      },
    };
  }

  const { content } = from;
  const kept = (section: CvSection) =>
    !from.sections || from.sections.includes(section);
  const shownRoles = new Set(content.experience.map((entry) => entry.roleId));
  const shownProjects = new Set(
    kept("projects") ? content.projects.map((entry) => entry.projectId) : [],
  );
  const known = new Set(profile.skills.map((skill) => skill.id));
  const refs = (id: string) =>
    (own.get(id) ?? []).map((line) => ({ ref: line.ref }));
  return {
    catalogue,
    form: {
      title: from.title,
      summary: shownSummary(from)?.text ?? "",
      skillIds: [...new Set(content.skillIds)]
        .filter((id) => known.has(id))
        .slice(0, EDIT_SKILLS_MAX),
      experience: roles.map((entry) => ({
        roleId: entry.id,
        shown: shownRoles.has(entry.id),
        lines: refs(entry.id),
      })),
      projects: projects.map((entry) => ({
        projectId: entry.id,
        shown: shownProjects.has(entry.id),
        lines: refs(entry.id),
      })),
      sections: filledSections(profile).filter(kept),
      length: from.length ?? defaultLength(profile),
    },
  };
}

/**
 * The CV the owner's edit makes, in the profile's order, with the code
 * check's flags. Throws a CvEditError when a line or entry it names isn't in
 * the CV or the profile anymore.
 */
export function editedContent(
  form: CvEditForm,
  profile: MasterProfile,
  from: EditFrom | null,
): { content: CvContent; flags: ClaimFlag[] } {
  const facts = factIndex(profileFacts(profile, null));
  const { catalogue } = editorStart(profile, from);
  const { roles, projects } = profileEntries(profile);
  const labels = new Map(
    [...roles, ...projects].map((entry) => [entry.id, entry.label]),
  );
  const flags: ClaimFlag[] = [];
  const check = (item: CitedText, entryId?: string) => {
    const problem = citationProblem(
      item,
      facts,
      entryId ? { id: entryId, label: labels.get(entryId) ?? "" } : undefined,
    );
    if (problem) flags.push({ itemId: item.id, text: item.text, ...problem });
  };

  const entries = (
    available: EditorEntry[],
    chosen: { id: string; shown: boolean; lines: { ref: string }[] }[],
  ) => {
    const byId = new Map(chosen.map((entry) => [entry.id, entry]));
    for (const entry of chosen) {
      if (!available.some((known) => known.id === entry.id)) {
        throw new CvEditError(STALE_MESSAGE);
      }
    }
    return available.flatMap((entry) => {
      const pick = byId.get(entry.id);
      if (!pick?.shown) return [];
      const lines = new Map(entry.lines.map((line) => [line.ref, line]));
      const refs = [...new Set(pick.lines.map((line) => line.ref))];
      const highlights = refs.map((ref, index) => {
        const line = lines.get(ref);
        if (!line) throw new CvEditError(STALE_MESSAGE);
        const item = {
          id: `${entry.id}:${index}`,
          text: line.text,
          sources: line.sources,
        };
        check(item, entry.id);
        return item;
      });
      return [{ id: entry.id, highlights }];
    });
  };

  const experience = entries(
    catalogue.roles,
    form.experience.map(({ roleId, ...rest }) => ({ id: roleId, ...rest })),
  ).map(({ id, highlights }) => ({ roleId: id, highlights }));
  const shownProjects = entries(
    catalogue.projects,
    form.projects.map(({ projectId, ...rest }) => ({ id: projectId, ...rest })),
  ).map(({ id, highlights }) => ({ projectId: id, highlights }));

  // The summary is the owner's to write. Kept as it was, it keeps what it
  // cited; changed, it stands on the profile's headline and summary.
  const text = form.summary.trim();
  const before = shownSummary(from);
  const summary =
    text === ""
      ? null
      : {
          id: "summary",
          text,
          sources:
            before && sameText(before.text, text)
              ? before.sources
              : [profile.basics.id],
        };
  if (summary) check(summary);

  const known = new Set(profile.skills.map((skill) => skill.id));
  const skillIds = [...new Set(form.skillIds)].filter((id) => known.has(id));
  const sections = CV_SECTIONS.filter((section) =>
    section === "projects"
      ? shownProjects.length > 0
      : (form.sections as CvSection[]).includes(section),
  );

  return {
    content: {
      kind: "cv",
      summary,
      experience,
      projects: shownProjects,
      skillIds,
      headline: form.title.trim(),
      sections,
    },
    flags,
  };
}
