// The code half of the claim check (step 9). Claude's tailored text becomes
// stored documents, and every piece of text that cites no profile fact, an
// id the profile doesn't have, or nothing from the role it sits under is
// flagged. Flagged text never reaches the PDF or the copy buttons.
import type { MasterProfile } from "@/lib/schemas/profile";
import type {
  AnswersContent,
  ClaimCheck,
  ClaimFlag,
  CitedText,
  CoverLetterContent,
  CvContent,
  DocumentContent,
  DocumentKind,
  TailorOutput,
} from "@/lib/schemas/tailor";

import type { Fact } from "./facts";

/** At most this many skills are listed on a tailored CV. */
export const MAX_CV_SKILLS = 20;

export type TailoredDocument = {
  kind: DocumentKind;
  content: DocumentContent;
  flags: ClaimFlag[];
};

type Cited = { text: string; sources: string[] };

const clean = (sources: string[]) => [
  ...new Set(sources.map((id) => id.trim()).filter((id) => id !== "")),
];

/**
 * Why a piece of text can't stay, or null when its citations hold up.
 * `entryId` is the role or project a bullet sits under: it must cite at
 * least one fact from that entry.
 */
export function citationProblem(
  item: CitedText,
  facts: Map<string, Fact>,
  entry?: { id: string; label: string },
): Pick<ClaimFlag, "kind" | "reason"> | null {
  if (item.sources.length === 0) {
    return { kind: "no_source", reason: "Cites no fact from your profile." };
  }
  const unknown = item.sources.filter((id) => !facts.has(id));
  if (unknown.length > 0) {
    return {
      kind: "unknown_source",
      reason: `Cites ${unknown.join(", ")}, which ${unknown.length === 1 ? "isn't" : "aren't"} in your profile.`,
    };
  }
  if (
    entry &&
    !item.sources.some((id) => facts.get(id)?.entryId === entry.id)
  ) {
    return {
      kind: "wrong_entry",
      reason: `Cites nothing from ${entry.label}.`,
    };
  }
  return null;
}

class Builder {
  readonly flags: ClaimFlag[] = [];

  constructor(private readonly facts: Map<string, Fact>) {}

  /** A piece of text, flagged when its citations don't hold up. */
  item(
    id: string,
    cited: Cited,
    entry?: { id: string; label: string },
  ): CitedText | null {
    const text = cited.text.trim();
    if (text === "") return null;
    const item = { id, text, sources: clean(cited.sources) };
    const problem = citationProblem(item, this.facts, entry);
    if (problem) this.flags.push({ itemId: id, text, ...problem });
    return item;
  }

  /** Text Claude put somewhere that doesn't exist, kept only as a flag. */
  orphan(id: string, text: string, reason: string) {
    if (text.trim() === "") return;
    this.flags.push({
      itemId: id,
      kind: "unknown_source",
      reason,
      text: text.trim(),
    });
  }
}

function toCv(
  output: TailorOutput["cv"],
  profile: MasterProfile,
  build: Builder,
): CvContent {
  const roles = new Map(profile.experience.map((role) => [role.id, role]));
  const projects = new Map(
    profile.projects.map((project) => [project.id, project]),
  );
  const highlightsByEntry = new Map<string, Cited[]>();
  const misplaced: { id: string; items: Cited[] }[] = [];
  for (const entry of [
    ...output.experience.map((e) => ({ id: e.roleId, items: e.highlights })),
    ...output.projects.map((p) => ({ id: p.projectId, items: p.highlights })),
  ]) {
    const id = entry.id.trim();
    if (roles.has(id) || projects.has(id)) {
      highlightsByEntry.set(id, [
        ...(highlightsByEntry.get(id) ?? []),
        ...entry.items,
      ]);
    } else {
      misplaced.push({ id, items: entry.items });
    }
  }

  const bullets = (entryId: string, label: string) =>
    (highlightsByEntry.get(entryId) ?? []).flatMap((item, index) => {
      const built = build.item(`${entryId}:${index}`, item, {
        id: entryId,
        label,
      });
      return built ? [built] : [];
    });

  // Flags come out in the order the CV reads.
  const summary = build.item("summary", output.summary);
  // Every role, in the profile's order, so the CV has no unexplained gaps.
  const experience = profile.experience.map((role) => ({
    roleId: role.id,
    highlights: bullets(role.id, `your role at ${role.company}`),
  }));
  const shownProjects = profile.projects
    .filter((project) => highlightsByEntry.has(project.id))
    .map((project) => ({
      projectId: project.id,
      highlights: bullets(project.id, `the ${project.name} project`),
    }));
  for (const entry of misplaced) {
    entry.items.forEach((item, index) =>
      build.orphan(
        `${entry.id}:${index}`,
        item.text,
        `Placed under ${entry.id}, which isn't a role or project in your profile.`,
      ),
    );
  }

  const skillIds: string[] = [];
  const knownSkills = new Set(profile.skills.map((skill) => skill.id));
  for (const raw of output.skillIds) {
    const id = raw.trim();
    if (skillIds.includes(id)) continue;
    if (!knownSkills.has(id)) {
      build.orphan(`skill:${id}`, id, `${id} isn't a skill in your profile.`);
      continue;
    }
    if (skillIds.length < MAX_CV_SKILLS) skillIds.push(id);
  }

  return {
    kind: "cv",
    summary,
    experience,
    projects: shownProjects,
    skillIds,
  };
}

function toCoverLetter(
  output: TailorOutput["coverLetter"],
  build: Builder,
): CoverLetterContent {
  return {
    kind: "cover_letter",
    paragraphs: output.paragraphs.flatMap((paragraph, index) => {
      const item = build.item(`p${index}`, paragraph);
      return item ? [item] : [];
    }),
  };
}

function toAnswers(
  output: TailorOutput["answers"],
  build: Builder,
): AnswersContent {
  return {
    kind: "answers",
    items: output.flatMap((answer, index) => {
      const question = answer.question.trim();
      if (question === "") return [];
      const missing = answer.missing.trim();
      const id = `a${index}`;
      // An answer left for the owner to write claims nothing.
      if (answer.answer.trim() === "") {
        return [{ id, text: "", sources: [], question, missing }];
      }
      const item = build.item(id, {
        text: answer.answer,
        sources: answer.sources,
      });
      return item ? [{ ...item, question, missing }] : [];
    }),
  };
}

/**
 * Turns Claude's output into the documents asked for, with the code check's
 * flags. Parts Claude wrote that weren't asked for are ignored.
 */
export function toDocuments(
  output: TailorOutput,
  kinds: readonly DocumentKind[],
  profile: MasterProfile,
  facts: Map<string, Fact>,
): TailoredDocument[] {
  return kinds.map((kind) => {
    const build = new Builder(facts);
    const content: DocumentContent =
      kind === "cv"
        ? toCv(output.cv, profile, build)
        : kind === "cover_letter"
          ? toCoverLetter(output.coverLetter, build)
          : toAnswers(output.answers, build);
    return { kind, content, flags: build.flags };
  });
}

/** Every piece of text in a document that makes a claim, for Claude's check. */
export function citedItems(content: DocumentContent): CitedText[] {
  switch (content.kind) {
    case "cv":
      return [
        ...(content.summary ? [content.summary] : []),
        ...content.experience.flatMap((entry) => entry.highlights),
        ...content.projects.flatMap((entry) => entry.highlights),
      ];
    case "cover_letter":
      return content.paragraphs;
    case "answers":
      return content.items.filter((item) => item.text !== "");
  }
}

/** The ids of the text left out of the PDF and the copy buttons. */
export function flaggedIds(check: ClaimCheck | null): Set<string> {
  return new Set(check?.flags.map((flag) => flag.itemId) ?? []);
}
