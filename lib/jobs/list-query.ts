// The SQL behind the role lists. Filtering, sorting and paging all
// happen in Postgres, so a page costs the same with 50 roles or 5,000.
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { application, event, job } from "@/db/schema";
import type { Db } from "@/lib/dal/db";
import { ROLE_FOCUS } from "@/lib/schemas/job";
import type { WantedFocus } from "@/lib/schemas/profile";
import { CLOSED_STATUSES } from "@/lib/schemas/tracker";

import type { FollowUpFilter, JobListParams, JobSort } from "./list-params";
import { FRESH_DAYS } from "./posted";
import { focusRank } from "./role-focus";
import type { OwnerClock } from "./today";

/** Escapes `%`, `_` and `\` so the search text matches literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** A follow-up that's due: from its day on, unless the role is closed. */
function dueCondition(today: string): SQL | undefined {
  return and(
    lte(job.followUpOn, today),
    notInArray(job.status, [...CLOSED_STATUSES]),
  );
}

function followUpCondition(
  filter: FollowUpFilter | null,
  today: string,
): SQL | undefined {
  switch (filter) {
    case "due":
      return dueCondition(today);
    case "set":
      return isNotNull(job.followUpOn);
    case "none":
      return isNull(job.followUpOn);
    case null:
      return undefined;
  }
}

/** Found after `since`. */
function foundAfterCondition(since: Date | null): SQL | undefined {
  return since ? gt(job.foundAt, since) : undefined;
}

/** The posting gives a salary: a top or a bottom of its range. */
const hasSalary = sql`(${job.facts} #>> '{salary,min}' is not null or ${job.facts} #>> '{salary,max}' is not null)`;

/**
 * The WHERE clause. `today` is the owner's date as "YYYY-MM-DD", for the
 * follow-ups that are due.
 */
export function jobListWhere(
  params: JobListParams,
  today: string,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  const text = params.q.trim();
  if (text) {
    const pattern = `%${escapeLike(text)}%`;
    conditions.push(or(ilike(job.company, pattern), ilike(job.title, pattern)));
  }
  if (params.status.length > 0) {
    conditions.push(inArray(job.status, params.status));
  }
  if (params.eligibility.length > 0) {
    conditions.push(inArray(job.eligibility, params.eligibility));
  }
  if (params.minScore !== null) {
    conditions.push(gte(job.score, params.minScore));
  }
  if (params.salary) conditions.push(hasSalary);
  conditions.push(foundAfterCondition(params.foundAfter));
  conditions.push(followUpCondition(params.followUp, today));

  return and(...conditions);
}

/**
 * The top of a posting's salary range, as a yearly amount. Currencies aren't
 * converted, so sorting by salary compares amounts as written.
 */
const yearlySalary = sql`coalesce(
  (${job.facts} #>> '{salary,max}')::numeric,
  (${job.facts} #>> '{salary,min}')::numeric
) * case ${job.facts} #>> '{salary,period}'
  when 'month' then 12
  when 'day' then 220
  when 'hour' then 1760
  else 1
end`;

/** What each sort orders by. `timeZone` is the owner's, for days. */
function sortExpression(
  sort: Exclude<JobSort, "priority">,
  timeZone: string,
): SQL {
  switch (sort) {
    case "found":
      return sql`${job.foundAt}`;
    case "posted":
      // A role with no posting date counts from the day it was found.
      return sql`coalesce(${job.postedOn}, (${job.foundAt} at time zone ${timeZone})::date)`;
    case "score":
      return sql`${job.score}`;
    case "company":
      return sql`lower(${job.company})`;
    case "title":
      return sql`lower(${job.title})`;
    case "status":
      // The enum's order: new, shortlisted, ready, applied, interviewing and on.
      return sql`${job.status}`;
    case "salary":
      return yearlySalary;
    case "applied":
      return sql`${application.appliedAt}`;
    case "followUp":
      return sql`${job.followUpOn}`;
  }
}

/**
 * focusRank as SQL: the wanted kind of role 0, the kinds near it 1, the rest
 * (and roles not scored yet) 2. Null when every kind ranks the same.
 */
function focusRankSql(wanted: WantedFocus): SQL | null {
  if (wanted === "any") return null;
  // The names and ranks come from the code, never from a request.
  const ranked = ROLE_FOCUS.map((focus) => ({
    focus,
    rank: focusRank(focus, wanted),
  })).filter(({ rank }) => rank < 2);
  return sql`case ${job.focus} ${sql.raw(
    ranked.map(({ focus, rank }) => `when '${focus}' then ${rank}`).join(" "),
  )} else 2 end`;
}

/**
 * The order the app gives kits in, as autoPick does: scored roles, the kind
 * of role the owner wants most first, then the kinds near it, then the rest;
 * in each, the newest postings first (one with no date counts as FRESH_DAYS
 * old), then the best scores.
 */
function priorityOrder(today: string, wanted: WantedFocus): SQL[] {
  const focus = focusRankSql(wanted);
  return [
    sql`${job.score} is null`,
    ...(focus ? [focus] : []),
    sql`case when ${job.postedOn} is null then ${FRESH_DAYS} else greatest(${today}::date - ${job.postedOn}, 0) end`,
    sql`${job.score} desc nulls last`,
  ];
}

/**
 * ORDER BY: the chosen column with empty values last in either direction,
 * then newest first, then the id so pages never overlap. `clock` is the
 * owner's date and time zone, for how old each posting is.
 */
export function jobListOrderBy(
  params: JobListParams,
  clock: OwnerClock,
  wanted: WantedFocus = "any",
): SQL[] {
  const direction = params.dir === "asc" ? sql`asc` : sql`desc`;
  return [
    ...(params.sort === "priority"
      ? priorityOrder(clock.today, wanted)
      : [
          sql`${sortExpression(params.sort, clock.timeZone)} ${direction} nulls last`,
        ]),
    sql`${job.foundAt} desc`,
    asc(job.id),
  ];
}

/**
 * When the role reached its status: its latest status change, or the kit
 * that made it ready. A role that never changed has its date found.
 */
const statusAt = sql`coalesce(
  (select max(${event.at}) from ${event}
    where ${event.jobId} = ${job.id}
    and ${event.type} in ('status_changed', 'documents_ready')),
  ${job.foundAt}
)`.mapWith(job.foundAt);

/** The columns a list row needs. */
export const jobListColumns = {
  id: job.id,
  title: job.title,
  company: job.company,
  url: job.canonicalUrl,
  applyUrl: job.applyUrl,
  status: job.status,
  eligibility: job.eligibility,
  eligibilityQuote: job.eligibilityQuote,
  eligibilityReasons: job.eligibilityReasons,
  score: job.score,
  scoreReasons: job.scoreReasons,
  facts: job.facts,
  foundAt: job.foundAt,
  postedOn: job.postedOn,
  followUpOn: job.followUpOn,
  hasNotes: sql<boolean>`coalesce(${job.notes}, '') <> ''`,
  appliedAt: application.appliedAt,
  statusAt,
  tailoring: job.tailoring,
};

type Queryable = Pick<Db, "select">;

/**
 * One page of roles, and how many roles of each status match the filters
 * other than status. Those counts give the page's total and the Roles
 * page's tabs. Each also says how many have a follow-up due, whatever the
 * follow-up filter, and how many were found after `newSince`, whatever the
 * found-after filter, for the New filter's count.
 */
export function buildJobListQuery(
  db: Queryable,
  params: JobListParams,
  clock: OwnerClock,
  {
    newSince = null,
    wanted = "any",
  }: {
    newSince?: Date | null;
    /** The kind of role the owner wants most, for the priority sort. */
    wanted?: WantedFocus;
  } = {},
) {
  const { today } = clock;
  const matching = and(
    followUpCondition(params.followUp, today),
    foundAfterCondition(params.foundAfter),
  );
  const fresh = foundAfterCondition(newSince);
  return {
    rows: db
      .select(jobListColumns)
      .from(job)
      .leftJoin(application, eq(application.jobId, job.id))
      .where(jobListWhere(params, today))
      .orderBy(...jobListOrderBy(params, clock, wanted))
      .limit(params.size)
      .offset(params.page * params.size),
    counts: db
      .select({
        status: job.status,
        count: matching
          ? sql<number>`count(*) filter (where ${matching})`.mapWith(Number)
          : count(),
        due: sql<number>`count(*) filter (where ${dueCondition(today)})`.mapWith(
          Number,
        ),
        fresh: (fresh
          ? sql<number>`count(*) filter (where ${fresh})`
          : sql<number>`0`
        ).mapWith(Number),
      })
      .from(job)
      .where(
        jobListWhere(
          { ...params, status: [], followUp: null, foundAfter: null },
          today,
        ),
      )
      .groupBy(job.status),
  };
}
