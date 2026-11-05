import { z } from "zod";

import { ELIGIBILITY } from "./job";
import { JOB_STATUSES } from "./tracker";

/**
 * Columns the list of roles can be sorted by. `posted`: the day the employer
 * posted it, else the day it was found. `priority`: the order the app gives
 * kits in (lib/jobs/auto-pick.ts), whatever the direction.
 */
export const JOB_SORTS = [
  "found",
  "posted",
  "priority",
  "score",
  "company",
  "title",
  "status",
  "salary",
  "applied",
  "followUp",
] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export const PAGE_SIZES = [25, 50, 100] as const;

/** "due": the follow-up date has come, on a role that's still open. */
export const FOLLOW_UP_FILTERS = ["due", "set", "none"] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

export const SEARCH_MAX = 200;

/**
 * The filters, sort and page of a list of roles, as the database query takes
 * them. The page is 0-based.
 */
export const jobListParamsSchema = z.object({
  q: z.string().max(SEARCH_MAX),
  status: z.array(z.enum(JOB_STATUSES)),
  eligibility: z.array(z.enum(ELIGIBILITY)),
  minScore: z.int().min(0).max(100).nullable(),
  /** Only postings that give a salary. */
  salary: z.boolean(),
  /** Only roles found after this time. */
  foundAfter: z.date().nullable(),
  followUp: z.enum(FOLLOW_UP_FILTERS).nullable(),
  sort: z.enum(JOB_SORTS),
  dir: z.enum(SORT_DIRECTIONS),
  page: z.int().min(0).max(100_000),
  size: z.literal(PAGE_SIZES),
});
