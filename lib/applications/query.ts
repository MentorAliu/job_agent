// The SQL behind the Applications page: every role applied to, with the
// latest email on each and whose move it is.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { application, job, jobEmail } from "@/db/schema";
import type { Db } from "@/lib/dal/db";
import { escapeLike } from "@/lib/jobs/list-query";
import { APPLIED_STATUSES } from "@/lib/mail/rules";

import {
  APPLICATIONS_PAGE_SIZE,
  CLOSED_APPLICATION_STATUSES,
  OPEN_APPLICATION_STATUSES,
  type ApplicationsParams,
  type ApplicationStage,
} from "./params";

type Queryable = Pick<Db, "select" | "selectDistinctOn">;

/**
 * The newest email read on each role, leaving out ones about something
 * else.
 */
function latestEmails(db: Queryable) {
  return db
    .selectDistinctOn([jobEmail.jobId], {
      jobId: jobEmail.jobId,
      emailId: jobEmail.id,
      author: jobEmail.author,
      outcome: jobEmail.outcome,
      sure: jobEmail.sure,
      senderName: jobEmail.senderName,
      summary: jobEmail.summary,
      replyNeeded: jobEmail.replyNeeded,
      handledAt: jobEmail.handledAt,
      pastedAt: jobEmail.createdAt,
    })
    .from(jobEmail)
    .where(
      and(
        isNotNull(jobEmail.jobId),
        eq(jobEmail.status, "done"),
        ne(jobEmail.outcome, "unrelated"),
      ),
    )
    .orderBy(jobEmail.jobId, desc(jobEmail.createdAt))
    .as("latest_email");
}

type LatestEmails = ReturnType<typeof latestEmails>;

/**
 * The owner's move: the company's latest email waits for a reply they
 * haven't sent, on an application that's still open.
 */
function yourTurn(latest: LatestEmails): SQL {
  return sql`(${inArray(job.status, [...OPEN_APPLICATION_STATUSES])} and coalesce(${latest.author} = 'employer' and ${latest.replyNeeded} and ${latest.handledAt} is null, false))`;
}

function stageCondition(
  stage: ApplicationStage,
  latest: LatestEmails,
): SQL | undefined {
  switch (stage) {
    case "all":
      return undefined;
    case "your_turn":
      return yourTurn(latest);
    case "waiting":
      return sql`(${inArray(job.status, [...OPEN_APPLICATION_STATUSES])} and not ${yourTurn(latest)})`;
    case "interviewing":
      return eq(job.status, "interviewing");
    case "offer":
      return eq(job.status, "offer");
    case "closed":
      return inArray(job.status, [...CLOSED_APPLICATION_STATUSES]);
  }
}

/** Every application matching the search and the date, whatever its stage. */
function baseWhere(params: ApplicationsParams, now: Date): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    inArray(job.status, [...APPLIED_STATUSES]),
  ];
  const text = params.q.trim();
  if (text) {
    const pattern = `%${escapeLike(text)}%`;
    conditions.push(or(ilike(job.company, pattern), ilike(job.title, pattern)));
  }
  if (params.within !== null) {
    conditions.push(
      gte(
        application.appliedAt,
        new Date(now.getTime() - params.within * 864e5),
      ),
    );
  }
  return and(...conditions);
}

/**
 * One page of applications, newest activity first, and how many match the
 * search and date in each stage.
 */
export function buildApplicationsQuery(
  db: Queryable,
  params: ApplicationsParams,
  now: Date,
  size = APPLICATIONS_PAGE_SIZE,
) {
  const latest = latestEmails(db);
  const lastActivity = sql`greatest(${latest.pastedAt}, ${application.appliedAt})`;
  const where = baseWhere(params, now);
  const count = (stage: ApplicationStage) => {
    const condition = stageCondition(stage, latest);
    return (
      condition
        ? sql<number>`count(*) filter (where ${condition})`
        : sql<number>`count(*)`
    ).mapWith(Number);
  };
  return {
    rows: db
      .select({
        id: job.id,
        title: job.title,
        company: job.company,
        status: job.status,
        appliedAt: application.appliedAt,
        lastActivityAt: lastActivity.mapWith(application.appliedAt),
        yourTurn: yourTurn(latest).mapWith(Boolean),
        emailCount: sql<number>`(select count(*) from ${jobEmail}
          where ${jobEmail.jobId} = ${job.id}
          and ${jobEmail.status} = 'done'
          and ${jobEmail.outcome} <> 'unrelated')`.mapWith(Number),
        latestEmail: {
          id: latest.emailId,
          author: latest.author,
          outcome: latest.outcome,
          sure: latest.sure,
          senderName: latest.senderName,
          summary: latest.summary,
          pastedAt: latest.pastedAt,
        },
      })
      .from(job)
      .leftJoin(application, eq(application.jobId, job.id))
      .leftJoin(latest, eq(latest.jobId, job.id))
      .where(and(where, stageCondition(params.stage, latest)))
      .orderBy(
        sql`${lastActivity} desc nulls last`,
        desc(job.foundAt),
        asc(job.id),
      )
      .limit(size)
      .offset(params.page * size),
    counts: db
      .select({
        all: count("all"),
        your_turn: count("your_turn"),
        waiting: count("waiting"),
        interviewing: count("interviewing"),
        offer: count("offer"),
        closed: count("closed"),
      })
      .from(job)
      .leftJoin(application, eq(application.jobId, job.id))
      .leftJoin(latest, eq(latest.jobId, job.id))
      .where(where),
  };
}
