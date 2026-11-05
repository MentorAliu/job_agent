// The CV builder's form, filled in from the saved profile so the owner only
// changes what they want, and the skills it names turned into profile facts.
import type {
  CvBuildForm,
  CvBuildRequest,
  CvSection,
} from "@/lib/schemas/cv-builder";
import {
  newFactId,
  type MasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";

/** How many skills the form starts with. */
const DEFAULT_LEAD_SKILLS = 8;

/** Long careers get two pages; short ones read better on one. */
const TWO_PAGES_FROM_ROLES = 4;

const skillKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/** The sections the profile has something for. */
function filledSections(profile: MasterProfile): CvSection[] {
  const sections: [CvSection, number][] = [
    ["projects", profile.projects.length],
    ["education", profile.education.length],
    ["certifications", profile.certifications.length],
    ["languages", profile.languages.length],
  ];
  return sections.filter(([, count]) => count > 0).map(([section]) => section);
}

/**
 * A new CV's form: the profile's headline as the target, the stack from the
 * job preferences as the skills to lead with (the profile's first skills
 * when none match), every section the profile has, and a length to suit
 * the career.
 */
export function defaultCvForm(
  profile: MasterProfile,
  preferences: Preferences | null,
): CvBuildForm {
  const byKey = new Map(
    profile.skills.map((skill) => [skillKey(skill.name), skill.name]),
  );
  const fromStack = (preferences?.stack ?? []).flatMap((name) => {
    const skill = byKey.get(skillKey(name));
    return skill ? [skill] : [];
  });
  const skills = (
    fromStack.length > 0 ? fromStack : profile.skills.map((skill) => skill.name)
  ).slice(0, DEFAULT_LEAD_SKILLS);

  return {
    targetTitle:
      profile.basics.headline.trim() ||
      profile.experience[0]?.title.trim() ||
      "",
    jobText: "",
    skills: [...new Set(skills)],
    length:
      profile.experience.length >= TWO_PAGES_FROM_ROLES
        ? "two_pages"
        : "one_page",
    sections: filledSections(profile),
    note: "",
  };
}

/** The form for building again from an earlier CV, with its skills by name. */
export function formFromRequest(
  request: CvBuildRequest,
  profile: MasterProfile,
): CvBuildForm {
  const names = new Map(profile.skills.map((skill) => [skill.id, skill.name]));
  const { skillIds, ...rest } = request;
  return {
    ...rest,
    skills: skillIds.flatMap((id) => {
      const name = names.get(id);
      return name ? [name] : [];
    }),
  };
}

/**
 * The skills the form names as profile skill ids, in its order. A name the
 * profile doesn't have becomes a new skill, so the CV can cite it like any
 * other fact; the caller saves it to the profile.
 */
export function resolveLeadSkills(
  profile: MasterProfile,
  names: string[],
): { skillIds: string[]; added: MasterProfile["skills"] } {
  const byKey = new Map(
    profile.skills.map((skill) => [skillKey(skill.name), skill.id]),
  );
  const skillIds: string[] = [];
  const added: MasterProfile["skills"] = [];
  for (const name of names) {
    const key = skillKey(name);
    let id = byKey.get(key);
    if (!id) {
      id = newFactId("skill");
      added.push({ id, name: name.trim().replace(/\s+/g, " "), category: "" });
      byKey.set(key, id);
    }
    if (!skillIds.includes(id)) skillIds.push(id);
  }
  return { skillIds, added };
}
