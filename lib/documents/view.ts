// Tailored documents as they're shown and sent: the CV and cover letter the
// PDFs are drawn from, the text behind the copy buttons, and the diff of a
// tailored CV against the master CV it came from. Flagged text is left out of
// everything the owner sends. Everything here is plain data, so the same view
// serves the PDF renderer, the apply kit and its Route Handler.
import {
  questionKey,
  type Answers,
  type HeaderLink,
  type MasterProfile,
} from "@/lib/schemas/profile";
import type {
  AnswersContent,
  ClaimCheck,
  ClaimFlag,
  CoverLetterContent,
  CvContent,
  CvSection,
  DocumentContent,
} from "@/lib/schemas/tailor";
import { flaggedIds } from "@/lib/tailor/citations";
import { isStandardAnswerId } from "@/lib/tailor/facts";

import { wordDiff, type DiffPart } from "./word-diff";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2022-03" as "Mar 2022", "2022" as it is. */
function formatPartialDate(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

/** "Mar 2022 – Present", "2018 – 2019", or "" when neither date is known. */
export function formatDateRange(
  start: string,
  end: string,
  current = false,
): string {
  const to = current ? "Present" : formatPartialDate(end);
  const from = formatPartialDate(start);
  if (!from && !to) return "";
  if (!from) return to;
  if (!to || from === to) return from;
  return `${from} – ${to}`;
}

// ---------------------------------------------------------------------------
// CV
// ---------------------------------------------------------------------------

export type CvView = {
  name: string;
  headline: string;
  /** Email, phone and location, the ones the profile has. */
  contact: string[];
  links: HeaderLink[];
  summary: string | null;
  experience: {
    id: string;
    title: string;
    company: string;
    location: string;
    dates: string;
    highlights: string[];
    /** The role's technologies, as the profile lists them. */
    technologies: string[];
  }[];
  projects: {
    id: string;
    name: string;
    role: string;
    url: string;
    dates: string;
    highlights: string[];
  }[];
  skills: string[];
  /** The same skills under the profile's categories, in the order they first come up. */
  skillGroups: { category: string; names: string[] }[];
  education: {
    id: string;
    title: string;
    institution: string;
    dates: string;
    details: string;
  }[];
  certifications: string[];
  languages: string[];
};

function header(profile: MasterProfile, links: readonly HeaderLink[]) {
  const { basics } = profile;
  return {
    name: basics.name,
    headline: basics.headline,
    contact: [basics.email, basics.phone, basics.location].filter(Boolean),
    links: links.map(({ label, url }) => ({ label, url })),
  };
}

/** Skills without a category in the profile are listed last, as Other. */
export const OTHER_SKILLS = "Other";

/** Skills under their categories, keeping the order they're listed in. */
export function groupSkills(
  skills: { name: string; category: string }[],
): CvView["skillGroups"] {
  const groups = new Map<string, string[]>();
  for (const skill of skills) {
    const category = skill.category.trim() || OTHER_SKILLS;
    groups.set(category, [...(groups.get(category) ?? []), skill.name]);
  }
  const other = groups.get(OTHER_SKILLS);
  groups.delete(OTHER_SKILLS);
  if (other) groups.set(OTHER_SKILLS, other);
  return [...groups].map(([category, names]) => ({ category, names }));
}

/**
 * The tailored CV as sent: the profile's own facts, with Claude's wording,
 * under the title and with the sections the owner kept when they edited it.
 * `links` are the ones drawn at the top, the profile's unless given.
 */
export function cvView(
  content: CvContent,
  check: ClaimCheck | null,
  profile: MasterProfile,
  links: readonly HeaderLink[] = profile.links,
): CvView {
  const flagged = flaggedIds(check);
  const keep = (section: CvSection) =>
    !content.sections || content.sections.includes(section);
  const visible = (items: { id: string; text: string }[]) =>
    items.filter((item) => !flagged.has(item.id)).map((item) => item.text);
  const roles = new Map(profile.experience.map((role) => [role.id, role]));
  const projects = new Map(
    profile.projects.map((project) => [project.id, project]),
  );
  const skills = new Map(profile.skills.map((skill) => [skill.id, skill]));
  const shownSkills = content.skillIds.flatMap((id) => {
    const skill = skills.get(id);
    return skill ? [skill] : [];
  });

  const top = header(profile, links);
  return {
    ...top,
    headline: content.headline?.trim() || top.headline,
    summary:
      content.summary && !flagged.has(content.summary.id)
        ? content.summary.text
        : null,
    experience: content.experience.flatMap(({ roleId, highlights }) => {
      const role = roles.get(roleId);
      if (!role) return [];
      return [
        {
          id: role.id,
          title: role.title,
          company: role.company,
          location: role.location,
          dates: formatDateRange(role.startDate, role.endDate, role.current),
          highlights: visible(highlights),
          technologies: role.technologies,
        },
      ];
    }),
    projects: content.projects.flatMap(({ projectId, highlights }) => {
      const project = projects.get(projectId);
      if (!project || !keep("projects")) return [];
      return [
        {
          id: project.id,
          name: project.name,
          role: project.role,
          url: project.url,
          dates: formatDateRange(project.startDate, project.endDate),
          highlights: visible(highlights),
        },
      ];
    }),
    skills: shownSkills.map((skill) => skill.name),
    skillGroups: groupSkills(shownSkills),
    education: (keep("education") ? profile.education : []).map((entry) => ({
      id: entry.id,
      title: [entry.degree, entry.field].filter(Boolean).join(", "),
      institution: entry.institution,
      dates: formatDateRange(entry.startDate, entry.endDate),
      details: entry.details,
    })),
    certifications: (keep("certifications") ? profile.certifications : []).map(
      (cert) =>
        [cert.name, cert.issuer, cert.date ? formatPartialDate(cert.date) : ""]
          .filter(Boolean)
          .join(", "),
    ),
    languages: (keep("languages") ? profile.languages : []).map((language) =>
      language.level ? `${language.name} (${language.level})` : language.name,
    ),
  };
}

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

export type LetterView = {
  name: string;
  contact: string[];
  links: HeaderLink[];
  greeting: string;
  paragraphs: string[];
  closing: string;
};

export function letterView(
  content: CoverLetterContent,
  check: ClaimCheck | null,
  profile: MasterProfile,
  company: string,
  links: readonly HeaderLink[] = profile.links,
): LetterView {
  const flagged = flaggedIds(check);
  const top = header(profile, links);
  return {
    name: top.name,
    contact: top.contact,
    links: top.links,
    greeting: `Dear ${company} hiring team,`,
    paragraphs: content.paragraphs
      .filter((paragraph) => !flagged.has(paragraph.id))
      .map((paragraph) => paragraph.text),
    closing: "Kind regards,",
  };
}

/** The letter as plain text, for the copy button. */
export function letterText(view: LetterView): string {
  return [
    view.greeting,
    ...view.paragraphs,
    `${view.closing}\n${view.name}`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type AnswerView = {
  id: string;
  question: string;
  answer: string;
  /** What the owner has to add, when the profile doesn't hold the answer. */
  missing: string;
  /** Left out of the copy buttons because its claims didn't check out. */
  flag: ClaimFlag | null;
  /** The answer comes from the owner's standard or saved answers. */
  fromStandard: boolean;
};

export function answersView(
  content: AnswersContent,
  check: ClaimCheck | null,
): AnswerView[] {
  const flags = new Map(check?.flags.map((flag) => [flag.itemId, flag]));
  return content.items.map((item) => ({
    id: item.id,
    question: item.question,
    answer: item.text,
    missing: item.missing,
    flag: flags.get(item.id) ?? null,
    fromStandard: item.sources.some(isStandardAnswerId),
  }));
}

/**
 * Fills an answer Claude left to the owner, or one left out because it
 * didn't check out, with the one they've saved since for the same question,
 * so the kit needn't be written again for it.
 */
export function withSavedAnswers(
  items: AnswerView[],
  answers: Answers,
): AnswerView[] {
  const saved = new Map(
    answers.extra.map((extra) => [questionKey(extra.question), extra.answer]),
  );
  return items.map((item) => {
    if (item.answer && !item.flag) return item;
    const answer = saved.get(questionKey(item.question));
    return answer
      ? { ...item, answer, missing: "", flag: null, fromStandard: true }
      : item;
  });
}

// ---------------------------------------------------------------------------
// The tailored CV against the master CV
// ---------------------------------------------------------------------------

export type DiffBullet = {
  id: string;
  text: string;
  /** The facts it cites, with their text, so the owner can compare. */
  from: { id: string; text: string }[];
  /** Word changes from the one bullet it rewords, when it cites exactly one. */
  changes: DiffPart[] | null;
  flag: ClaimFlag | null;
};

export type DiffEntry = {
  id: string;
  title: string;
  bullets: DiffBullet[];
  /** Bullets in the master CV that the tailored CV leaves out. */
  leftOut: string[];
};

export type CvDiff = {
  summary: {
    before: string;
    after: string | null;
    changes: DiffPart[] | null;
    flag: ClaimFlag | null;
  };
  entries: DiffEntry[];
  skills: { shown: string[]; leftOut: string[] };
  /** Flagged text placed under a role or project the profile doesn't have. */
  orphans: ClaimFlag[];
};

export function cvDiff(
  content: CvContent,
  check: ClaimCheck | null,
  profile: MasterProfile,
): CvDiff {
  const flags = new Map(check?.flags.map((flag) => [flag.itemId, flag]));
  const highlightText = new Map<string, string>();
  const entryText = new Map<string, string>();
  for (const entry of [...profile.experience, ...profile.projects]) {
    entryText.set(
      entry.id,
      "title" in entry ? `${entry.title} at ${entry.company}` : entry.name,
    );
    for (const highlight of entry.highlights) {
      highlightText.set(highlight.id, highlight.text);
    }
  }
  const sourceText = (id: string) =>
    highlightText.get(id) ??
    entryText.get(id) ??
    (id === profile.basics.id ? profile.basics.summary : undefined) ??
    profile.skills.find((skill) => skill.id === id)?.name;

  const diffEntry = (
    id: string,
    title: string,
    master: { id: string; text: string }[],
    bullets: CvContent["experience"][number]["highlights"],
  ): DiffEntry => {
    const cited = new Set(bullets.flatMap((bullet) => bullet.sources));
    return {
      id,
      title,
      bullets: bullets.map((bullet) => {
        const from = bullet.sources.flatMap((source) => {
          const text = sourceText(source);
          return text ? [{ id: source, text }] : [];
        });
        const reworded = bullet.sources.filter((s) => highlightText.has(s));
        return {
          id: bullet.id,
          text: bullet.text,
          from,
          changes:
            reworded.length === 1
              ? wordDiff(highlightText.get(reworded[0]) ?? "", bullet.text)
              : null,
          flag: flags.get(bullet.id) ?? null,
        };
      }),
      leftOut: master
        .filter((highlight) => !cited.has(highlight.id))
        .map((highlight) => highlight.text),
    };
  };

  const roles = new Map(profile.experience.map((role) => [role.id, role]));
  const projects = new Map(
    profile.projects.map((project) => [project.id, project]),
  );
  const shownSkills = new Set(content.skillIds);
  const entryIds = new Set([
    ...content.experience.map((entry) => entry.roleId),
    ...content.projects.map((entry) => entry.projectId),
  ]);

  return {
    summary: {
      before: profile.basics.summary,
      after: content.summary?.text ?? null,
      changes:
        content.summary && profile.basics.summary
          ? wordDiff(profile.basics.summary, content.summary.text)
          : null,
      flag: content.summary ? (flags.get(content.summary.id) ?? null) : null,
    },
    entries: [
      ...content.experience.flatMap(({ roleId, highlights }) => {
        const role = roles.get(roleId);
        return role
          ? [
              diffEntry(
                role.id,
                `${role.title}, ${role.company}`,
                role.highlights,
                highlights,
              ),
            ]
          : [];
      }),
      ...content.projects.flatMap(({ projectId, highlights }) => {
        const project = projects.get(projectId);
        return project
          ? [
              diffEntry(
                project.id,
                project.name,
                project.highlights,
                highlights,
              ),
            ]
          : [];
      }),
    ],
    skills: {
      shown: content.skillIds.flatMap((id) => {
        const skill = profile.skills.find((s) => s.id === id);
        return skill ? [skill.name] : [];
      }),
      leftOut: profile.skills
        .filter((skill) => !shownSkills.has(skill.id))
        .map((skill) => skill.name),
    },
    orphans: (check?.flags ?? []).filter((flag) => {
      const [entry] = flag.itemId.split(":");
      return (
        flag.itemId.includes(":") &&
        !flag.itemId.startsWith("skill:") &&
        !entryIds.has(entry)
      );
    }),
  };
}

// ---------------------------------------------------------------------------
// Plain text, for a regenerate request
// ---------------------------------------------------------------------------

/**
 * A document as plain text, so Claude can revise it with the owner's note.
 * Flagged text is left out, so Claude isn't shown it as a claim to keep.
 */
export function documentText(
  content: DocumentContent,
  check: ClaimCheck | null,
  profile: MasterProfile,
): string {
  const flagged = flaggedIds(check);
  switch (content.kind) {
    case "cv": {
      const view = cvView(content, check, profile);
      const lines: string[] = [];
      if (view.summary) lines.push(`Summary: ${view.summary}`);
      for (const role of view.experience) {
        lines.push(`${role.title}, ${role.company}`);
        for (const highlight of role.highlights) lines.push(`- ${highlight}`);
      }
      for (const project of view.projects) {
        lines.push(`Project ${project.name}`);
        for (const highlight of project.highlights)
          lines.push(`- ${highlight}`);
      }
      lines.push(`Skills: ${view.skills.join(", ")}`);
      return lines.join("\n");
    }
    case "cover_letter":
      return content.paragraphs
        .filter((paragraph) => !flagged.has(paragraph.id))
        .map((paragraph) => paragraph.text)
        .join("\n\n");
    case "answers":
      return content.items
        .map(
          (item) =>
            `Q: ${item.question}\nA: ${
              item.text && !flagged.has(item.id)
                ? item.text
                : `(left for the candidate: ${item.missing || "not in the profile"})`
            }`,
        )
        .join("\n\n");
  }
}
