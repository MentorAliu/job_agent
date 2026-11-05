// "New" roles: the ones found since the owner's last visit to the Roles
// page. The visits are kept in a cookie, so nothing is written to the
// database and the browser keeps its own count.

export const ROLES_SEEN_COOKIE = "roles-seen";

/** Long enough for a browser to keep it: Chrome caps cookies at 400 days. */
export const ROLES_SEEN_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * A visit lasts while the owner keeps coming back to the Roles page within
 * this long, so opening a role and coming back keeps its New badge.
 */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Before the first recorded visit, roles found in the past day are new. */
export const FIRST_VISIT_MS = 24 * 60 * 60 * 1000;

export type RolesSeen = {
  /** When the owner last opened the Roles page. */
  seenAt: Date;
  /** The cut-off for New during that visit: where the visit before it ended. */
  newSince: Date;
};

/** The cookie's value, or null when it's missing or not one of ours. */
export function parseRolesSeen(value: string | undefined): RolesSeen | null {
  const match = /^(\d{1,15})\.(\d{1,15})$/.exec(value ?? "");
  if (!match) return null;
  const seenAt = new Date(Number(match[1]));
  const newSince = new Date(Number(match[2]));
  return newSince <= seenAt ? { seenAt, newSince } : null;
}

export function serializeRolesSeen(seen: RolesSeen): string {
  return `${seen.seenAt.getTime()}.${seen.newSince.getTime()}`;
}

/**
 * Roles found after this are New on the Roles page: during a visit, those
 * found since the visit before it; on a new visit, those found since the
 * last one.
 */
export function newSince(seen: RolesSeen | null, now: Date): Date {
  if (!seen) return new Date(now.getTime() - FIRST_VISIT_MS);
  return now.getTime() - seen.seenAt.getTime() > VISIT_GAP_MS
    ? seen.seenAt
    : seen.newSince;
}

/**
 * Roles found after this haven't been on the Roles page yet, for the top
 * bar's count: it clears once the owner opens the page.
 */
export function unseenSince(seen: RolesSeen | null, now: Date): Date {
  return seen ? seen.seenAt : new Date(now.getTime() - FIRST_VISIT_MS);
}

/** The cookie after the owner opens the Roles page at `now`. */
export function markSeen(seen: RolesSeen | null, now: Date): RolesSeen {
  return { seenAt: now, newSince: newSince(seen, now) };
}

/** Whether a role found at `foundAt` (ISO) counts as New. */
export function isNewRole(foundAt: string, since: Date | null): boolean {
  return since !== null && Date.parse(foundAt) > since.getTime();
}
