import "server-only";

import {
  and,
  count,
  desc,
  gte,
  inArray,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";

import { application, document, event, job } from "@/db/schema";
import { AUTO_PICK_MIN_SCORE } from "@/lib/jobs/auto-pick";
import {
  jobEventSchema,
  type JobEvent,
  type JobStatus,
} from "@/lib/schemas/tracker";

import { db, type Db } from "./db";
import { getCurrentUser } from "./session";
import { monthStart } from "./spend";

// The Overview's numbers: what went out, what came back, and what the app
// did. Every figure comes from the job, application and event tables.

type Queryable = Pick<Db, "select">;

/** Statuses that mean the employer answered. */
const REPLY_STATUSES = ["interviewing", "offer", "rejected"] as const;
const INTERVIEW_STATUSES = ["interviewing", "offer"] as const;

/** The funnel looks at roles found in this many days. */
export const FUNNEL_DAYS = 30;

/** Whether the role's timeline has a move to one of `statuses`. */
function reached(statuses: readonly string[]) {
  return sql`exists (select 1 from ${event} where ${event.jobId} = ${job.id} and ${event.type} = 'status_changed' and ${event.payload}->>'to' in (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )}))`;
}

const counted = (condition: ReturnType<typeof sql>) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** Roles found since `since`, and how far each got. */
export function funnelQuery(database: Queryable, since: Date) {
  return database
    .select({
      found: count(),
      canTake: counted(sql`${job.eligibility} in ('eligible', 'unclear')`),
      strong: counted(sql`${job.score} >= ${AUTO_PICK_MIN_SCORE}`),
      kits: counted(
        sql`exists (select 1 from ${document} where ${document.jobId} = ${job.id} and ${document.readyAt} is not null)`,
      ),
      sent: counted(
        sql`exists (select 1 from ${application} where ${application.jobId} = ${job.id})`,
      ),
      replies: counted(reached(REPLY_STATUSES)),
      interviews: counted(reached(INTERVIEW_STATUSES)),
    })
    .from(job)
    .where(gte(job.foundAt, since));
}

/** Every application, and how many the employer has answered. */
export function repliesQuery(database: Queryable) {
  return database
    .select({ sent: count(), replied: counted(reached(REPLY_STATUSES)) })
    .from(application)
    .innerJoin(job, sql`${job.id} = ${application.jobId}`);
}

/** Applications sent between two dates. */
export function sentQuery(database: Queryable, from: Date, to: Date) {
  return database
    .select({ sent: count() })
    .from(application)
    .where(
      and(gte(application.appliedAt, from), lt(application.appliedAt, to)),
    );
}

export type Funnel = {
  found: number;
  canTake: number;
  strong: number;
  kits: number;
  sent: number;
  replies: number;
  interviews: number;
};

export type OverviewStats = {
  sentThisMonth: number;
  sentLastMonth: number;
  /** Every application so far, and how many got an answer. */
  sentTotal: number;
  replied: number;
  /** Roles at Interviewing or Offer now, and their companies. */
  interviews: { count: number; companies: string[] };
  funnel: Funnel;
};

export async function getOverviewStats(
  now = new Date(),
): Promise<OverviewStats> {
  await getCurrentUser();
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, 1);
  const since = new Date(now.getTime() - FUNNEL_DAYS * 864e5);
  const [[funnel], [replies], [current], [previous], talking] =
    await Promise.all([
      funnelQuery(db, since),
      repliesQuery(db),
      sentQuery(db, thisMonth, now),
      sentQuery(db, lastMonth, thisMonth),
      db
        .select({ company: job.company })
        .from(job)
        .where(inArray(job.status, [...INTERVIEW_STATUSES]))
        .orderBy(desc(job.foundAt)),
    ]);
  return {
    sentThisMonth: current?.sent ?? 0,
    sentLastMonth: previous?.sent ?? 0,
    sentTotal: replies?.sent ?? 0,
    replied: replies?.replied ?? 0,
    interviews: {
      count: talking.length,
      companies: talking.map((row) => row.company),
    },
    funnel: {
      found: funnel?.found ?? 0,
      canTake: funnel?.canTake ?? 0,
      strong: funnel?.strong ?? 0,
      kits: funnel?.kits ?? 0,
      sent: funnel?.sent ?? 0,
      replies: funnel?.replies ?? 0,
      interviews: funnel?.interviews ?? 0,
    },
  };
}

export type ActivityEvent = JobEvent & {
  id: string;
  at: string;
  job: { id: string; title: string; company: string; status: JobStatus };
};

/**
 * Status moves a person would want to hear about, newest first. The app's
 * own picks and pass-overs are left out: the search that made them says how
 * many there were, and each picked role shows up again when its kit is ready.
 * A closed listing is news only for a role the app picked. Removing and
 * restoring a role is the owner's own doing, so it isn't news either.
 */
const QUIET_STATUSES = [
  "new",
  "shortlisted",
  "skipped",
  "not_eligible",
  "removed",
];

/**
 * The latest things that happened to roles: kits ready, emails from
 * companies and status moves. A move an email made shows as the email.
 */
export async function getRecentActivity(limit = 8): Promise<ActivityEvent[]> {
  await getCurrentUser();
  const rows = await db
    .select({
      id: event.id,
      type: event.type,
      payload: event.payload,
      at: event.at,
      jobId: job.id,
      title: job.title,
      company: job.company,
      status: job.status,
    })
    .from(event)
    .innerJoin(job, sql`${job.id} = ${event.jobId}`)
    .where(
      sql`(${event.type} = 'documents_ready'
        or (${event.type} = 'status_changed'
          and ${notInArray(sql`${event.payload}->>'to'`, QUIET_STATUSES)}
          and not (${event.payload}->>'to' = 'listing_closed'
            and ${event.payload}->>'from' = 'new')
          and ${event.payload}->>'from' <> 'removed'
          and coalesce(${event.payload}->>'source', '') <> 'email')
        or (${event.type} = 'email_added'
          and ${event.payload}->>'author' = 'employer'
          and ${event.payload}->>'outcome' <> 'unrelated'))`,
    )
    .orderBy(desc(event.at))
    .limit(limit);
  return rows.flatMap((row) => {
    const parsed = jobEventSchema.safeParse(row);
    return parsed.success
      ? [
          {
            ...parsed.data,
            id: row.id,
            at: row.at.toISOString(),
            job: {
              id: row.jobId,
              title: row.title,
              company: row.company,
              status: row.status,
            },
          },
        ]
      : [];
  });
}
