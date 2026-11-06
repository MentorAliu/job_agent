import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";

import { addedRole, builtCv, file, job, jobEmail } from "@/db/schema";
import { DEFAULT_APPLICATIONS_PARAMS } from "@/lib/applications/params";
import { buildApplicationsQuery } from "@/lib/applications/query";
import { unseenSince } from "@/lib/jobs/new-roles";
import {
  claudeWorking,
  CV_READ_MS,
  nextStep,
  searchStatus,
  type TopBarView,
} from "@/lib/jobs/top-bar";
import { hourIn } from "@/lib/jobs/today";
import { shortlistedToday } from "@/lib/pipeline/autopilot";
import { checkSearchBlock } from "@/lib/pipeline/runs";
import { readSettings } from "@/lib/pipeline/settings";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import { ADDED_ROLE_STALE_MS } from "@/lib/schemas/added-role";
import { READING_STALE_MS } from "@/lib/schemas/mail";

import { db } from "./db";
import { readRolesSeen } from "./roles-seen";
import { getLatestRun } from "./runs";
import { getCurrentUser } from "./session";

/**
 * Everything the top bar shows: the search, the roles new since the owner
 * last opened Roles, and the reply or kit that's next. The reply is the one
 * the Applications page lists first, and the kit the first on Roles.
 */
export async function getTopBar(now = new Date()): Promise<TopBarView> {
  await getCurrentUser();
  const replies = buildApplicationsQuery(
    db,
    { ...DEFAULT_APPLICATIONS_PARAMS, stage: "your_turn" },
    now,
    1,
  );
  const [seen, timeZone] = await Promise.all([
    readRolesSeen(),
    readOwnerTimeZone(),
  ]);
  const since = unseenSince(seen, now);
  const [latest, block, settings, kitsToday, [fresh], [reply], [kit], work] =
    await Promise.all([
      getLatestRun(),
      checkSearchBlock(),
      readSettings(),
      shortlistedToday(timeZone, now),
      db
        .select({ count: count() })
        .from(job)
        .where(and(gt(job.foundAt, since), ne(job.status, "removed"))),
      replies.rows,
      db
        .select({ id: job.id, company: job.company })
        .from(job)
        .where(eq(job.status, "ready"))
        .orderBy(desc(job.foundAt), asc(job.id))
        .limit(1),
      readWork(now),
    ]);
  return {
    search: searchStatus({
      latest,
      block,
      dailyRunOn: settings.dailyRunEnabled,
      hour: hourIn(timeZone, now),
      kitsToday,
    }),
    newRoles: fresh?.count ?? 0,
    next: nextStep(
      reply ? { jobId: reply.id, company: reply.company } : null,
      kit ? { jobId: kit.id, company: kit.company } : null,
    ),
    working: claudeWorking({ latest, ...work }, now),
  };
}

/**
 * Claude's work besides searches: kits being made, CVs being built, and
 * emails, uploaded CVs and added roles being read.
 */
async function readWork(now: Date) {
  const since = (ms: number) => new Date(now.getTime() - ms);
  const [kits, cvs, [emails], [uploads], [added]] = await Promise.all([
    db
      .select({ tailoring: job.tailoring })
      .from(job)
      .where(sql`${job.tailoring}->>'status' in ('queued', 'running')`),
    db
      .select({ status: builtCv.status, createdAt: builtCv.createdAt })
      .from(builtCv)
      .where(notInArray(builtCv.status, ["ready", "failed"])),
    db
      .select({ count: count() })
      .from(jobEmail)
      .where(
        and(
          eq(jobEmail.status, "reading"),
          gt(jobEmail.queuedAt, since(READING_STALE_MS)),
        ),
      ),
    db
      .select({ count: count() })
      .from(file)
      .where(
        and(
          eq(file.parseStatus, "pending"),
          gt(file.createdAt, since(CV_READ_MS)),
        ),
      ),
    db
      .select({ count: count() })
      .from(addedRole)
      .where(
        and(
          eq(addedRole.status, "reading"),
          gt(addedRole.createdAt, since(ADDED_ROLE_STALE_MS)),
        ),
      ),
  ]);
  return {
    kits: kits.flatMap((row) => (row.tailoring ? [row.tailoring] : [])),
    cvs,
    reads: (emails?.count ?? 0) + (uploads?.count ?? 0) + (added?.count ?? 0),
  };
}
