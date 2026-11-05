// Lists of roles: their filters, sort and page, kept in URLs with nuqs. The
// same parsers read the query string of GET /api/jobs and the Roles page's
// URL on the server, so both agree.
import {
  createLoader,
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsIndex,
  parseAsInteger,
  parseAsIsoDateTime,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
  type SingleParserBuilder,
} from "nuqs/server";
import type { z } from "zod";

import { ELIGIBILITY } from "@/lib/schemas/job";
import {
  FOLLOW_UP_FILTERS,
  JOB_SORTS,
  jobListParamsSchema,
  PAGE_SIZES,
  SORT_DIRECTIONS,
} from "@/lib/schemas/job-list";
import { JOB_STATUSES } from "@/lib/schemas/tracker";

import { AUTO_PICK_MIN_SCORE } from "./auto-pick";
import { ROLE_TABS, TAB_STATUSES, type RoleTab } from "./stages";

export {
  FOLLOW_UP_FILTERS,
  JOB_SORTS,
  PAGE_SIZES,
  type FollowUpFilter,
  type JobSort,
} from "@/lib/schemas/job-list";

/**
 * Keeps only values the schema accepts, so a hand-edited URL such as
 * `?page=0` falls back to the default instead of reaching the database.
 */
function checked<T>(parser: SingleParserBuilder<T>, schema: z.ZodType) {
  return createParser<T>({
    parse: (value) => {
      const parsed = parser.parse(value);
      return parsed !== null && schema.safeParse(parsed).success
        ? parsed
        : null;
    },
    serialize: parser.serialize,
  });
}

const fields = jobListParamsSchema.shape;

/** The page: 1-based in the URL, 0-based here. */
const parsePage = checked(parseAsIndex, fields.page).withDefault(0);

/** Everything that changes which rows the server returns. */
export const jobListParsers = {
  q: checked(parseAsString, fields.q).withDefault(""),
  status: parseAsArrayOf(parseAsStringLiteral(JOB_STATUSES)).withDefault([]),
  eligibility: parseAsArrayOf(parseAsStringLiteral(ELIGIBILITY)).withDefault(
    [],
  ),
  minScore: checked(parseAsInteger, fields.minScore),
  salary: parseAsBoolean.withDefault(false),
  foundAfter: parseAsIsoDateTime,
  followUp: parseAsStringLiteral(FOLLOW_UP_FILTERS),
  sort: parseAsStringLiteral(JOB_SORTS).withDefault("found"),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault("desc"),
  page: parsePage,
  size: parseAsNumberLiteral(PAGE_SIZES).withDefault(25),
};

export type JobListParams = inferParserType<typeof jobListParsers>;

export const loadJobListParams = createLoader(jobListParsers);
export const serializeJobListParams = createSerializer(jobListParsers);

/** The defaults: every role, newest first, page 1. */
export const DEFAULT_JOB_LIST_PARAMS: JobListParams = loadJobListParams({});

/**
 * The Roles page's quick filters. `new`: found since the last visit to the
 * page. `strong`: scores the app picks at. `salary`: the posting gives one.
 */
export const ROLE_FILTERS = ["new", "strong", "salary"] as const;
export type RoleFilter = (typeof ROLE_FILTERS)[number];

/**
 * The Roles page's orders. Each tab has its own default (TAB_SORTS).
 * `next`: the order the app gives kits in. `newest`: the newest postings.
 */
export const ROLE_SORTS = ["ready", "next", "best", "newest"] as const;
export type RoleSort = (typeof ROLE_SORTS)[number];

/** The Roles page's URL: its tab, quick filters, order and page. */
export const rolesParsers = {
  tab: parseAsStringLiteral(ROLE_TABS).withDefault("to_send"),
  only: parseAsArrayOf(parseAsStringLiteral(ROLE_FILTERS)).withDefault([]),
  /** Null for the tab's own order. */
  sort: parseAsStringLiteral(ROLE_SORTS),
  page: parsePage,
};

export type RolesParams = inferParserType<typeof rolesParsers>;

export const loadRolesParams = createLoader(rolesParsers);
export const serializeRolesParams = createSerializer(rolesParsers);

/** The Roles page as it opens: the roles to send, in their own order. */
export const DEFAULT_ROLES_PARAMS: RolesParams = loadRolesParams({});

/** Each tab's own order: what's nearest to done comes first. */
export const TAB_SORTS: Record<RoleTab, RoleSort> = {
  // Ready kits before the ones still being written.
  to_send: "ready",
  // The roles that get the next free kits first.
  waiting: "next",
  passed: "newest",
  all: "newest",
  removed: "newest",
};

const SORTS: Record<RoleSort, Pick<JobListParams, "sort" | "dir">> = {
  ready: { sort: "status", dir: "desc" },
  next: { sort: "priority", dir: "desc" },
  best: { sort: "score", dir: "desc" },
  newest: { sort: "posted", dir: "desc" },
};

/** Orders that fit only their own tab: To send's and Waiting's. */
const OWN_TAB_ONLY: readonly RoleSort[] = ["ready", "next"];

/** The orders a tab offers, its own first. */
export function tabSorts(tab: RoleTab): RoleSort[] {
  const own = TAB_SORTS[tab];
  return [
    own,
    ...ROLE_SORTS.filter(
      (sort) => sort !== own && !OWN_TAB_ONLY.includes(sort),
    ),
  ];
}

/** The order a view lists in: the one picked, if the tab offers it. */
export function viewSort(view: Pick<RolesParams, "tab" | "sort">): RoleSort {
  return view.sort && tabSorts(view.tab).includes(view.sort)
    ? view.sort
    : TAB_SORTS[view.tab];
}

/**
 * The list parameters for a view of the Roles page. `newSince` is where New
 * starts, from the owner's last visit (lib/jobs/new-roles.ts).
 */
export function rolesListParams(
  view: RolesParams,
  newSince: Date | null = null,
): JobListParams {
  const only = new Set(view.only);
  return {
    ...DEFAULT_JOB_LIST_PARAMS,
    ...SORTS[viewSort(view)],
    status: [...TAB_STATUSES[view.tab]],
    minScore: only.has("strong") ? AUTO_PICK_MIN_SCORE : null,
    salary: only.has("salary"),
    foundAfter: only.has("new") ? newSince : null,
    page: view.page,
  };
}

/** The Overview's kits: picked roles, ready ones first. */
export const TO_SEND_PARAMS: JobListParams = rolesListParams({
  ...DEFAULT_ROLES_PARAMS,
  tab: "to_send",
});

/**
 * The Overview's next up: strong roles waiting for a free kit, in the order
 * the app gives kits.
 */
export const NEXT_UP_PARAMS: JobListParams = {
  ...rolesListParams({ ...DEFAULT_ROLES_PARAMS, tab: "waiting" }),
  minScore: AUTO_PICK_MIN_SCORE,
};
