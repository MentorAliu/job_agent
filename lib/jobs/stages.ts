// The Roles page's tabs: which statuses each one lists, and how many roles
// are in each. Roles applied to have their own page, Applications.
import { JOB_STATUSES, type JobStatus } from "@/lib/schemas/tracker";

/** Roles on their way to an offer, from being picked onwards. */
export const WORKING_STATUSES = [
  "shortlisted",
  "ready",
  "applied",
  "interviewing",
  "offer",
] as const satisfies readonly JobStatus[];

export const ROLE_TABS = [
  "to_send",
  "waiting",
  "passed",
  "all",
  "removed",
] as const;
export type RoleTab = (typeof ROLE_TABS)[number];

export const TAB_STATUSES: Record<RoleTab, readonly JobStatus[]> = {
  /** Picked by the app: the kit is being written, or is ready. */
  to_send: ["shortlisted", "ready"],
  /** Strong roles over the day's kits, and roles that couldn't be scored. */
  waiting: ["new"],
  /** Passed over by the app or the owner, or closed by the employer. */
  passed: ["skipped", "not_eligible", "listing_closed"],
  /** Every role but the ones the owner removed. */
  all: JOB_STATUSES.filter((status) => status !== "removed"),
  removed: ["removed"],
};

/**
 * The roles with one status that match the list's filters, how many of them
 * have a follow-up due whatever the follow-up filter, and how many are New
 * whatever the New filter.
 */
export type StatusCount = { count: number; due: number; fresh: number };
export type StatusCounts = Record<JobStatus, StatusCount>;

export function emptyStatusCounts(): StatusCounts {
  return Object.fromEntries(
    JOB_STATUSES.map((status) => [status, { count: 0, due: 0, fresh: 0 }]),
  ) as StatusCounts;
}

/** A tab's roles: the counts of its statuses added up. */
export function tabCount(
  counts: StatusCounts,
  tab: RoleTab,
  field: keyof StatusCount = "count",
): number {
  return TAB_STATUSES[tab].reduce(
    (sum, status) => sum + counts[status][field],
    0,
  );
}
