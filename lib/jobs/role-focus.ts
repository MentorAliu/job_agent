// What a role mainly works on. The score says it for each posting; a job
// title says it well enough for roles scored before the score did, and for
// choosing which postings on a company's board to read.
import type { RoleFocus } from "@/lib/schemas/job";
import type { Preferences, WantedFocus } from "@/lib/schemas/profile";

const FULL_STACK = /full[\s-]?stack/i;
const FRONTEND =
  /front[\s-]?end|\bui\b|\bux engineer|design engineer|\bweb (?:developer|engineer|application)|\breact\b|next\.?js|\bvue\b|angular|svelte|javascript|typescript/i;
const MOBILE = /\b(?:ios|android|mobile|react native|flutter)\b/i;
// \b needs a letter on one side, so ".NET", "C++" and "C#" get their own checks.
const BACKEND =
  /back[\s-]?end|\b(?:data|ml|machine learning|ai|devops|sre|site reliability|infrastructure|platform|cloud|security|embedded|firmware|database|java|python|golang|ruby|rails|php|rust|scala|elixir)\b|\bgo (?:developer|engineer)\b|\.net\b|\bc\+\+|\bc#/i;

/** The focus a job title suggests. */
export function focusFromTitle(title: string): RoleFocus {
  if (FULL_STACK.test(title)) return "fullstack";
  // React Native is mobile work, though its name says React.
  if (FRONTEND.test(title.replace(/react native/gi, ""))) return "frontend";
  if (MOBILE.test(title)) return "mobile";
  if (BACKEND.test(title)) return "backend";
  return "other";
}

/**
 * Lower comes first: the kind of role the owner wants most, then roles that
 * share its work (full-stack for frontend or backend, and the other way
 * round), then the rest. With "any", every role ranks the same.
 */
export function focusRank(
  focus: RoleFocus | null,
  wanted: WantedFocus,
): number {
  if (wanted === "any" || focus === wanted) return 0;
  const near =
    (focus === "fullstack" &&
      (wanted === "frontend" || wanted === "backend")) ||
    (wanted === "fullstack" && (focus === "frontend" || focus === "backend"));
  return near ? 1 : 2;
}

/** Below a junior's seniority. */
const JUNIOR =
  /\b(?:junior|jr\.?|intern|internship|graduate|trainee|working student|werkstudent|apprentice|entry[\s-]level)\b/i;
/** Not a developer's job, whatever its stack. */
const NOT_DEVELOPMENT =
  /\b(?:designer|manager|director|head of|vp|vice president|sales|account|marketing|recruiter|recruiting|talent|support|success|solutions|analyst|scientist|researcher|writer|counsel|legal|finance|qa|quality|tester|sdet)\b/i;
/** A developer's job that doesn't name its focus, such as "Senior Software Engineer". */
const DEVELOPMENT = /\b(?:engineer|developer|programmer)\b/i;

/**
 * Whether a posting on a company's board is worth reading, by its title: the
 * kind of role the owner wants and roles near it (see focusRank), and
 * developer roles that don't say what they focus on. Junior roles only when
 * the owner looks for them. Null for any other role. Lower comes first.
 */
export function boardTitleRank(
  title: string,
  {
    roleFocus,
    seniority,
  }: {
    roleFocus: WantedFocus;
    seniority: readonly Preferences["seniority"][number][];
  },
): number | null {
  const juniorWanted = seniority.length === 0 || seniority.includes("junior");
  if (NOT_DEVELOPMENT.test(title) || (!juniorWanted && JUNIOR.test(title))) {
    return null;
  }
  const focus = focusFromTitle(title);
  if (focus === "other") {
    return DEVELOPMENT.test(title) ? (roleFocus === "any" ? 0 : 2) : null;
  }
  const rank = focusRank(focus, roleFocus);
  return rank < 2 ? rank : null;
}
