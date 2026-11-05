import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  ne,
  notExists,
  sql,
} from "drizzle-orm";

import { application, event, job, jobEmail, profile } from "@/db/schema";
import type {
  EarlierEmail,
  EmailCandidate,
  EmailRole,
  ReadEmailResult,
} from "@/lib/claude/read-email";
import { db } from "@/lib/dal/db";
import { APPLIED_STATUSES } from "@/lib/mail/rules";
import { answersSchema, masterProfileSchema } from "@/lib/schemas/profile";
import { MAX_EARLIER_EMAILS, READING_STALE_MS } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

import { readOwnerTimeZone } from "./setup";

import { applyEmailToRole } from "./job-writes";

// Pasted emails, for the Inngest step that reads them and the daily No
// response sweep. Those run with no signed-in user, so this lives here
// rather than in lib/dal.

/** Skills sent along with an email, at most. */
const MAX_SKILLS = 30;
/** Applications listed for an email pasted without a role, at most. */
export const MAX_LISTED_ROLES = 60;

export type PastedEmail = {
  id: string;
  jobId: string | null;
  body: string;
  status: typeof jobEmail.$inferSelect.status;
};

export async function getPastedEmail(id: string): Promise<PastedEmail | null> {
  const [row] = await db
    .select({
      id: jobEmail.id,
      jobId: jobEmail.jobId,
      body: jobEmail.body,
      status: jobEmail.status,
    })
    .from(jobEmail)
    .where(eq(jobEmail.id, id));
  return row ?? null;
}

const month = (date: string) => date || "now";

const LINK_LABELS = {
  linkedin: "LinkedIn",
  github: "GitHub",
  portfolio: "Portfolio",
} as const;

/** "GitHub: https://…", once per address. */
function uniqueByUrl(links: { label: string; url: string }[]): string[] {
  const seen = new Set<string>();
  return links.flatMap(({ label, url }) => {
    const key = url.trim().replace(/\/+$/, "").toLowerCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [`${label}: ${url.trim()}`];
  });
}

/** The owner's details a suggested reply may use. */
export async function getEmailCandidate(): Promise<EmailCandidate> {
  const [[row], timeZone] = await Promise.all([
    db
      .select({ data: profile.data, answers: profile.answers })
      .from(profile)
      .where(eq(profile.id, 1)),
    readOwnerTimeZone(),
  ]);
  const parsed = masterProfileSchema.safeParse(row?.data);
  const answers = answersSchema.safeParse(row?.answers);
  const data = parsed.success ? parsed.data : null;
  const saved = answers.success ? answers.data : null;
  return {
    name: data?.basics.name ?? "",
    headline: data?.basics.headline ?? "",
    location: data?.basics.location ?? "",
    timeZone,
    noticePeriod: saved?.noticePeriod ?? "",
    workAuthorization: saved?.workAuthorization ?? "",
    links: uniqueByUrl([
      ...(data?.links ?? []),
      ...(["linkedin", "github", "portfolio"] as const).map((key) => ({
        label: LINK_LABELS[key],
        url: saved?.links[key] ?? "",
      })),
    ]),
    experience:
      data?.experience.map(
        (role) =>
          `${role.title} at ${role.company}, ${month(role.startDate)} to ${role.current ? "now" : month(role.endDate)}`,
      ) ?? [],
    skills: data?.skills.slice(0, MAX_SKILLS).map((skill) => skill.name) ?? [],
  };
}

/**
 * Every application's company, so an email pasted without a role can be
 * matched to any of them, not just the ones Claude gets listed.
 */
export async function getAppliedCompanies(): Promise<
  { id: string; company: string }[]
> {
  return db
    .select({ id: job.id, company: job.company })
    .from(job)
    .where(inArray(job.status, [...APPLIED_STATUSES]));
}

/**
 * The applications an email may be about, newest application first: the
 * given roles, or every role applied to. With `earlier`, each comes with the
 * emails already on it, oldest first, leaving out `exceptEmailId`.
 */
export async function getEmailRoles({
  jobIds,
  earlier,
  exceptEmailId,
}: {
  jobIds: string[] | null;
  earlier: boolean;
  exceptEmailId?: string;
}): Promise<EmailRole[]> {
  if (jobIds?.length === 0) return [];
  const rows = await db
    .select({
      id: job.id,
      company: job.company,
      title: job.title,
      status: job.status,
      appliedAt: application.appliedAt,
    })
    .from(job)
    .leftJoin(application, eq(application.jobId, job.id))
    .where(
      jobIds
        ? inArray(job.id, jobIds)
        : inArray(job.status, [...APPLIED_STATUSES]),
    )
    .orderBy(sql`${application.appliedAt} desc nulls last`, desc(job.foundAt))
    .limit(MAX_LISTED_ROLES);

  const emails = new Map<string, EarlierEmail[]>();
  if (earlier && rows.length > 0) {
    const ranked = db
      .select({
        jobId: jobEmail.jobId,
        createdAt: jobEmail.createdAt,
        author: jobEmail.author,
        outcome: jobEmail.outcome,
        summary: jobEmail.summary,
        reply: jobEmail.reply,
        handledAt: jobEmail.handledAt,
        rank: sql<number>`row_number() over (partition by ${jobEmail.jobId} order by ${jobEmail.createdAt} desc)`.as(
          "rank",
        ),
      })
      .from(jobEmail)
      .where(
        and(
          inArray(
            jobEmail.jobId,
            rows.map((row) => row.id),
          ),
          eq(jobEmail.status, "done"),
          exceptEmailId ? ne(jobEmail.id, exceptEmailId) : undefined,
        ),
      )
      .as("ranked");
    const found = await db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, MAX_EARLIER_EMAILS))
      .orderBy(asc(ranked.createdAt));
    for (const email of found) {
      if (!email.jobId) continue;
      const list = emails.get(email.jobId) ?? [];
      list.push({
        pastedAt: email.createdAt.toISOString(),
        author: email.author,
        outcome: email.outcome,
        summary: email.summary ?? "",
        reply: email.reply
          ? { body: email.reply.body, used: email.handledAt !== null }
          : null,
      });
      emails.set(email.jobId, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    company: row.company,
    title: row.title,
    status: row.status,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    earlier: emails.get(row.id) ?? [],
  }));
}

/**
 * Saves what Claude read in an email, and files it under `jobId` unless the
 * owner already filed it elsewhere. Then the email moves its role on. Only
 * an email still being read is saved, so a retried step writes nothing
 * twice. Returns where the email went and the status its role moved to.
 */
export async function saveEmailReading(
  emailId: string,
  jobId: string | null,
  reading: ReadEmailResult,
  now = new Date(),
): Promise<{
  saved: boolean;
  jobId: string | null;
  movedTo: JobStatus | null;
}> {
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .update(jobEmail)
      .set({
        jobId: sql`coalesce(${jobEmail.jobId}, ${jobId}::uuid)`,
        status: "done",
        error: null,
        author: reading.author,
        outcome: reading.outcome,
        sure: reading.sure,
        quote: reading.quote,
        senderName: reading.senderName,
        subject: reading.subject,
        summary: reading.summary,
        keyPoints: reading.keyPoints,
        replyNeeded: reading.replyNeeded,
        reply: reading.reply,
        readAt: now,
      })
      .where(and(eq(jobEmail.id, emailId), eq(jobEmail.status, "reading")))
      .returning({ jobId: jobEmail.jobId });
    if (!saved) return { saved: false, jobId: null, movedTo: null };
    if (!saved.jobId) return { saved: true, jobId: null, movedTo: null };

    const movedTo = await applyEmailToRole(tx, {
      emailId,
      jobId: saved.jobId,
      author: reading.author,
      outcome: reading.outcome,
      quote: reading.quote,
      sure: reading.sure,
      summary: reading.summary,
    });
    return { saved: true, jobId: saved.jobId, movedTo };
  });
}

/**
 * Says why an email couldn't be read, so the page offers to try again. With
 * `sentAt`, when the failed run's event was sent, it leaves alone an email
 * sent to be read again since: Try again only takes a read stuck for
 * READING_STALE_MS, so half that is room for the clocks to differ.
 */
export async function markEmailFailed(
  emailId: string,
  message: string,
  sentAt?: Date,
): Promise<void> {
  await db
    .update(jobEmail)
    .set({ status: "failed", error: message.slice(0, 500) })
    .where(
      and(
        eq(jobEmail.id, emailId),
        eq(jobEmail.status, "reading"),
        sentAt
          ? lt(
              jobEmail.queuedAt,
              new Date(sentAt.getTime() + READING_STALE_MS / 2),
            )
          : undefined,
      ),
    );
}

/**
 * Moves applied roles with no email from the company in `days` days to No
 * response, since the owner pastes every email they get. Returns how many
 * moved.
 */
export async function markUnanswered(
  days: number,
  now = new Date(),
): Promise<number> {
  if (days <= 0) return 0;
  const before = new Date(now.getTime() - days * 864e5);
  const reason = `No email from them in ${days} days.`;
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: job.id })
      .from(job)
      .innerJoin(application, eq(application.jobId, job.id))
      .where(
        and(
          eq(job.status, "applied"),
          lte(application.appliedAt, before),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(jobEmail)
              .where(
                and(
                  eq(jobEmail.jobId, job.id),
                  eq(jobEmail.author, "employer"),
                  ne(jobEmail.outcome, "unrelated"),
                  // An automatic confirmation from back then isn't an answer.
                  gt(jobEmail.createdAt, before),
                ),
              ),
          ),
        ),
      )
      .for("update", { of: job });
    for (const { id } of stale) {
      await tx.update(job).set({ status: "no_response" }).where(eq(job.id, id));
      await tx.insert(event).values({
        jobId: id,
        type: "status_changed",
        payload: {
          from: "applied",
          to: "no_response",
          reason,
          source: "no_reply",
        },
      });
    }
    return stale.length;
  });
}
