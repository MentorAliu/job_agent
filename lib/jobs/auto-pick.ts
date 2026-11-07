// The app's own decisions on new matches, after each search: the best ones
// get an apply kit, the weak and the stale ones are passed over, and strong
// ones over the day's limit wait for the next search. The kind of role the
// owner wants most gets kits first, then the newest postings.
import type { RoleFocus } from "@/lib/schemas/job";
import type { WantedFocus } from "@/lib/schemas/profile";

import {
  freshnessAge,
  isStale,
  postedAgo,
  postingAgeDays,
  STALE_DAYS,
} from "./posted";
import { focusRank } from "./role-focus";

/** Matches scoring this or more get an apply kit. */
export const AUTO_PICK_MIN_SCORE = 75;
/** At most this many kits a day (the owner's day), so the cost stays known. */
export const AUTO_KITS_PER_DAY = 3;
/** An upper estimate of one kit: snapshot, tailoring and claim check. */
export const KIT_ESTIMATE_USD = 0.1;

export type Candidate = {
  id: string;
  score: number;
  /** What the role mainly works on. */
  focus: RoleFocus;
  /** The day it was posted, "YYYY-MM-DD", or null when unknown. */
  postedOn: string | null;
};

export type AutoPickPlan = {
  /** Roles that get a kit now, first to last. */
  pick: Candidate[];
  /** Roles below the bar, or posted too long ago, passed over. */
  pass: Candidate[];
  /** Roles over the bar that wait for a later search, next first. */
  wait: Candidate[];
};

/**
 * The order kits go in: the kind of role the owner wants most first, then
 * the kinds near it, then the rest (see focusRank); in each, the newest
 * postings first, then the best scores. A posting with no date counts as a
 * week old. list-query.ts sorts Next up the same way.
 */
export function kitOrder(today: string, wanted: WantedFocus) {
  return (a: Candidate, b: Candidate): number =>
    focusRank(a.focus, wanted) - focusRank(b.focus, wanted) ||
    freshnessAge(a.postedOn, today) - freshnessAge(b.postedOn, today) ||
    b.score - a.score;
}

/** Whether a role is passed over: below the bar, or too old for a kit. */
function passes(candidate: Candidate, today: string): boolean {
  return (
    candidate.score < AUTO_PICK_MIN_SCORE || isStale(candidate.postedOn, today)
  );
}

/**
 * Sorts scored new matches: the first ones up to `slots` get a kit, the
 * ones below the bar or posted more than STALE_DAYS ago are passed over, and
 * the rest wait.
 */
export function planAutoPick(
  candidates: Candidate[],
  slots: number,
  wanted: WantedFocus,
  today: string,
): AutoPickPlan {
  const strong = candidates
    .filter((candidate) => !passes(candidate, today))
    .sort(kitOrder(today, wanted));
  const free = Math.max(0, slots);
  return {
    pick: strong.slice(0, free),
    pass: candidates.filter((candidate) => passes(candidate, today)),
    wait: strong.slice(free),
  };
}

/** Kits the app can still start today, given those started and the budget. */
export function kitSlots(startedToday: number, remainingUsd: number): number {
  const affordable = Math.floor(remainingUsd / KIT_ESTIMATE_USD);
  return Math.max(0, Math.min(AUTO_KITS_PER_DAY - startedToday, affordable));
}

export function pickedReason(candidate: Candidate, today: string): string {
  const posted = candidate.postedOn
    ? `, posted ${postedAgo(candidate.postedOn, today)}`
    : "";
  return `Picked automatically: it scored ${candidate.score}${posted}.`;
}

/**
 * How the reason for a role passed over for its score begins. A profile
 * change brings such roles back to be scored again (lib/jobs/rescore.ts).
 */
export const LOW_SCORE_PASS_PREFIX = "Passed over automatically: it scored ";

export function passedReason(candidate: Candidate, today: string): string {
  if (candidate.score < AUTO_PICK_MIN_SCORE || !candidate.postedOn) {
    return `${LOW_SCORE_PASS_PREFIX}${candidate.score}, below ${AUTO_PICK_MIN_SCORE}.`;
  }
  return `Passed over automatically: it was posted ${postingAgeDays(candidate.postedOn, today)} days ago, and kits go only to postings up to ${STALE_DAYS} days old. It scored ${candidate.score}.`;
}
