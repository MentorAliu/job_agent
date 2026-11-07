// Scoring again after the owner changes what scoring reads: the profile
// (from a new CV, an edit or a skill the CV builder added) or the job
// preferences. Roles still waiting for a kit, and roles passed over for
// their score that are fresh enough for one, are scored against the new
// profile at the next search, which a change starts a few minutes after the
// last save (inngest/profile-changed.ts).
import { isStale, STALE_DAYS } from "./posted";
import { addDays } from "./today";

/**
 * At most this many roles are scored again for one change, so the search it
 * starts still has room to score new postings (MAX_SCORES_PER_RUN is 60).
 * Scoring one costs well under a tenth of a cent.
 */
export const MAX_RESCORED_ROLES = 40;

/**
 * Searches profile changes can start in the owner's day. A search costs
 * about what the daily one does; a change after these is scored at the
 * next search.
 */
export const PROFILE_SEARCHES_PER_DAY = 3;

/**
 * How long the app waits after the last save before it searches, so a few
 * edits in a row (the profile, then the preferences) start one search.
 */
export const PROFILE_CHANGE_QUIET = "5m";

/** The timeline line on a passed-over role that goes back to New. */
export const RESCORE_REASON =
  "Back to New to be scored again: your profile changed.";

/** A role that may be scored again. */
export type RescoreCandidate = {
  id: string;
  /** New: scored and waiting for a kit. Skipped: passed over for its score. */
  status: "new" | "skipped";
  /** The day it was posted, "YYYY-MM-DD", or null when unknown. */
  postedOn: string | null;
  /** The day the app found it, "YYYY-MM-DD", in the owner's time zone. */
  foundOn: string;
};

/**
 * The roles to score again, first to last: those waiting for a kit, then
 * the passed-over ones, the newest first in each. A posting too old for a
 * kit is left out, and so is a passed-over role found more than STALE_DAYS
 * ago, since kits go only to fresh postings.
 */
export function pickRolesToRescore(
  candidates: readonly RescoreCandidate[],
  today: string,
  limit = MAX_RESCORED_ROLES,
): string[] {
  const oldestFound = addDays(today, -STALE_DAYS);
  const day = (role: RescoreCandidate) => role.postedOn ?? role.foundOn;
  return candidates
    .filter(
      (role) =>
        !isStale(role.postedOn, today) &&
        (role.status === "new" || role.foundOn >= oldestFound),
    )
    .sort(
      (a, b) =>
        Number(a.status === "skipped") - Number(b.status === "skipped") ||
        day(b).localeCompare(day(a)),
    )
    .slice(0, Math.max(0, limit))
    .map((role) => role.id);
}

/** What decides whether a profile change starts a search now. */
export type ProfileSearchState = {
  /** First-run setup is finished; setup starts its own first search. */
  setupDone: boolean;
  /** Settings has the daily run on. With it off, the app never searches by itself. */
  dailyRunEnabled: boolean;
  /** What scoring reads changed since the roles were last scored. */
  changed: boolean;
  /** Searches profile changes started in the owner's day so far. */
  searchesToday: number;
};

/**
 * Why a profile change doesn't start a search, or null when it does. The
 * roles are still scored again at the next search the owner or the daily
 * run starts.
 */
export function profileSearchBlock(state: ProfileSearchState): string | null {
  if (!state.setupDone) return "First-run setup isn't finished yet.";
  if (!state.dailyRunEnabled) {
    return "The daily run is off in Settings, so the roles are scored again at the next search you start.";
  }
  if (!state.changed) return "Nothing that scoring reads changed.";
  if (state.searchesToday >= PROFILE_SEARCHES_PER_DAY) {
    return `Profile changes already started ${PROFILE_SEARCHES_PER_DAY} searches today, so the roles are scored again at the next search.`;
  }
  return null;
}
