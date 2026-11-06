import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { application, document, event, job, profile } from "@/db/schema";
import { answersView, withSavedAnswers } from "@/lib/documents/view";
import { DEFAULT_APPLICATIONS_PARAMS } from "@/lib/applications/params";
import { buildApplicationsQuery } from "@/lib/applications/query";
import { answerProgress } from "@/lib/jobs/kit-steps";
import type { JobListParams } from "@/lib/jobs/list-params";
import { buildJobListQuery, jobListColumns } from "@/lib/jobs/list-query";
import {
  emptyStatusCounts,
  WORKING_STATUSES,
  type StatusCounts,
} from "@/lib/jobs/stages";
import { addDays, dayIn, ownerClock } from "@/lib/jobs/today";
import { writeFollowUp, type Tx } from "@/lib/pipeline/job-writes";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import type { Eligibility, JobFacts, ScoreReasons } from "@/lib/schemas/job";
import {
  answersSchema,
  defaultAnswers,
  WANTED_FOCUS,
  type WantedFocus,
} from "@/lib/schemas/profile";
import {
  FOLLOW_UP_DAYS,
  isLostTailoring,
  TAILORABLE_STATUSES,
  type DocumentKind,
  type TailorState,
} from "@/lib/schemas/tailor";
import {
  BEFORE_APPLYING,
  JOB_STATUSES,
  jobEventSchema,
  type JobEvent,
  type JobStatus,
  type StatusChange,
} from "@/lib/schemas/tracker";

import { db } from "./db";
import { getCurrentUser } from "./session";

// Roles for the Overview, the Roles page and the role page. Dates are ISO
// strings, so a role looks the same from a Server Component and from
// GET /api/jobs.

export type SalaryView = {
  min: number | null;
  max: number | null;
  currency: string;
  period: JobFacts["salary"]["period"];
};

export type JobListRow = {
  id: string;
  title: string;
  company: string;
  /** The posting. */
  url: string;
  applyUrl: string | null;
  status: JobStatus;
  eligibility: Eligibility | null;
  eligibilityQuote: string | null;
  eligibilityReasons: string[];
  score: number | null;
  scoreReasons: ScoreReasons | null;
  summary: string | null;
  workplace: JobFacts["location"]["workplace"] | null;
  /**
   * The countries or regions candidates may work from, as the posting lists
   * them. Empty when it names none, or names only where the team is.
   */
  places: string[];
  seniority: JobFacts["seniority"] | null;
  contract: JobFacts["contract"] | null;
  /** The application deadline, "YYYY-MM-DD". */
  deadline: string | null;
  salary: SalaryView | null;
  stack: string[];
  foundAt: string;
  /** The day the employer posted it, "YYYY-MM-DD", when known. */
  postedOn: string | null;
  appliedAt: string | null;
  /** "YYYY-MM-DD" */
  followUpOn: string | null;
  hasNotes: boolean;
  /** When the role reached its status, or when it was found. */
  statusAt: string;
  /** Tailoring that's going, or that failed, for the apply kit. */
  tailoring: "active" | "failed" | null;
  /**
   * Before applying, how many of the kit's answers the owner has to give
   * themselves. Null without a ready set of answers.
   */
  answersForYou: number | null;
};

export type JobListPage = {
  rows: JobListRow[];
  /** How many roles match the filters, on every page. */
  total: number;
  /** How many roles of each status match the filters other than status. */
  statuses: StatusCounts;
  page: number;
  size: number;
  /**
   * Today in the owner's time zone, "YYYY-MM-DD", for how old each posting
   * is. The time zone is saved on the server, so the list gets it from here.
   */
  today: string;
};

export type TimelineEvent = JobEvent & { id: string; at: string };

export type JobDetail = JobListRow & {
  facts: JobFacts | null;
  /** The posting's text as read, shown as plain text. */
  description: string | null;
  notes: string;
  firstRunId: string | null;
  /** The owner added it by hand, rather than a search finding it. */
  addedByOwner: boolean;
  /** Newest first. */
  events: TimelineEvent[];
  /**
   * Today in the owner's time zone, "YYYY-MM-DD". The time zone is saved on
   * the server, so the page gets it from here.
   */
  today: string;
};

export class JobNotFoundError extends Error {
  constructor() {
    super("That role no longer exists.");
    this.name = "JobNotFoundError";
  }
}

type ListRowColumns = Awaited<
  ReturnType<typeof buildJobListQuery>["rows"]
>[number];

export function salaryView(facts: JobFacts | null): SalaryView | null {
  const salary = facts?.salary;
  if (!salary || (salary.min === null && salary.max === null)) return null;
  return {
    min: salary.min,
    max: salary.max,
    currency: salary.currency,
    period: salary.period,
  };
}

function tailoringState(state: TailorState | null): JobListRow["tailoring"] {
  if (!state) return null;
  if (state.status === "failed" || isLostTailoring(state)) return "failed";
  return state.status === "queued" || state.status === "running"
    ? "active"
    : null;
}

function toListRow(row: ListRowColumns): JobListRow {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    url: row.url,
    applyUrl: row.applyUrl,
    status: row.status,
    eligibility: row.eligibility,
    eligibilityQuote: row.eligibilityQuote,
    eligibilityReasons: row.eligibilityReasons ?? [],
    score: row.score,
    scoreReasons: row.scoreReasons,
    summary: row.facts?.summary || null,
    workplace: row.facts?.location.workplace ?? null,
    places:
      row.facts && row.facts.location.placesAre !== "team_locations"
        ? row.facts.location.allowed
        : [],
    seniority: row.facts?.seniority ?? null,
    contract: row.facts?.contract ?? null,
    deadline: row.facts?.deadline || null,
    salary: salaryView(row.facts),
    stack: row.facts?.stack.slice(0, 8) ?? [],
    foundAt: row.foundAt.toISOString(),
    postedOn: row.postedOn,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    followUpOn: row.followUpOn,
    hasNotes: row.hasNotes,
    statusAt: row.statusAt.toISOString(),
    tailoring: tailoringState(row.tailoring),
    answersForYou: null,
  };
}

/**
 * Fills in, for roles not yet applied to, how many answers in their latest
 * ready set the owner has to give themselves, counting the answers they've
 * saved since as given.
 */
async function withAnswersForYou<T extends JobListRow>(
  rows: T[],
): Promise<T[]> {
  const ids = rows
    .filter((row) =>
      (TAILORABLE_STATUSES as readonly JobStatus[]).includes(row.status),
    )
    .map((row) => row.id);
  if (ids.length === 0) return rows;

  const [sets, [current]] = await Promise.all([
    db
      .selectDistinctOn([document.jobId], {
        jobId: document.jobId,
        content: document.content,
        claimFlags: document.claimFlags,
      })
      .from(document)
      .where(
        and(
          inArray(document.jobId, ids),
          eq(document.kind, "answers"),
          isNotNull(document.readyAt),
        ),
      )
      .orderBy(document.jobId, desc(document.version)),
    db
      .select({ answers: profile.answers })
      .from(profile)
      .where(eq(profile.id, 1)),
  ]);
  const parsed = answersSchema.safeParse(current?.answers);
  const saved = parsed.success ? parsed.data : defaultAnswers;
  const forYou = new Map(
    sets.flatMap((set) =>
      set.content.kind === "answers"
        ? [
            [
              set.jobId,
              answerProgress({
                items: withSavedAnswers(
                  answersView(set.content, set.claimFlags),
                  saved,
                ),
              }).forYou.length,
            ] as const,
          ]
        : [],
    ),
  );
  return rows.map((row) =>
    forYou.has(row.id) ? { ...row, answersForYou: forYou.get(row.id)! } : row,
  );
}

/** The kind of role the owner wants most, from the job preferences. */
async function wantedFocus(): Promise<WantedFocus> {
  const [row] = await db
    .select({ focus: sql<string | null>`${profile.preferences}->>'roleFocus'` })
    .from(profile)
    .where(eq(profile.id, 1));
  const focus = WANTED_FOCUS.find((value) => value === row?.focus);
  return focus ?? "any";
}

/**
 * One page of roles, filtered and sorted in the database. With `newSince`,
 * the counts also say how many roles of each status are New.
 */
export async function listJobs(
  params: JobListParams,
  { newSince = null }: { newSince?: Date | null } = {},
): Promise<JobListPage> {
  await getCurrentUser();
  const [wanted, timeZone] = await Promise.all([
    params.sort === "priority" ? wantedFocus() : ("any" as const),
    readOwnerTimeZone(),
  ]);
  const clock = ownerClock(timeZone);
  const query = buildJobListQuery(db, params, clock, {
    newSince,
    wanted,
  });
  const [rows, counted] = await Promise.all([query.rows, query.counts]);
  const statuses = emptyStatusCounts();
  for (const entry of counted) {
    statuses[entry.status] = {
      count: entry.count,
      due: entry.due,
      fresh: entry.fresh,
    };
  }
  const listed: readonly JobStatus[] =
    params.status.length > 0 ? params.status : JOB_STATUSES;
  return {
    rows: await withAnswersForYou(rows.map(toListRow)),
    total: listed.reduce((sum, status) => sum + statuses[status].count, 0),
    statuses,
    page: params.page,
    size: params.size,
    today: clock.today,
  };
}

/** A role with its facts, notes and timeline, for the detail drawer. */
export async function getJobDetail(id: string): Promise<JobDetail | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      ...jobListColumns,
      description: job.descriptionMd,
      notes: job.notes,
      firstRunId: job.firstRunId,
      addedByOwner: job.addedByOwner,
    })
    .from(job)
    .leftJoin(application, eq(application.jobId, job.id))
    .where(eq(job.id, id));
  if (!row) return null;

  const [events, timeZone] = await Promise.all([
    db
      .select({
        id: event.id,
        type: event.type,
        payload: event.payload,
        at: event.at,
      })
      .from(event)
      .where(eq(event.jobId, id))
      .orderBy(desc(event.at), desc(event.id)),
    readOwnerTimeZone(),
  ]);

  const [listed] = await withAnswersForYou([toListRow(row)]);
  return {
    ...listed!,
    facts: row.facts,
    description: row.description,
    notes: row.notes ?? "",
    firstRunId: row.firstRunId,
    addedByOwner: row.addedByOwner,
    // An event this version doesn't know is left out, not shown wrong.
    events: events.flatMap((entry) => {
      const parsed = jobEventSchema.safeParse(entry);
      return parsed.success
        ? [{ ...parsed.data, id: entry.id, at: entry.at.toISOString() }]
        : [];
    }),
    today: dayIn(timeZone),
  };
}

/**
 * How many kits are ready to send, how many roles are being worked on, and
 * how many companies wait for the owner's reply.
 */
export async function getJobCounts(): Promise<{
  readyToSend: number;
  inProgress: number;
  yourTurn: number;
}> {
  await getCurrentUser();
  const replies = buildApplicationsQuery(
    db,
    DEFAULT_APPLICATIONS_PARAMS,
    new Date(),
  ).counts;
  const [[row], [applications]] = await Promise.all([
    db
      .select({
        readyToSend:
          sql<number>`count(*) filter (where ${job.status} = 'ready')`.mapWith(
            Number,
          ),
        inProgress:
          sql<number>`count(*) filter (where ${inArray(job.status, [...WORKING_STATUSES])})`.mapWith(
            Number,
          ),
      })
      .from(job),
    replies,
  ]);
  return {
    readyToSend: row?.readyToSend ?? 0,
    inProgress: row?.inProgress ?? 0,
    yourTurn: applications?.your_turn ?? 0,
  };
}

/**
 * Sets a role's status and adds it to the timeline, with a reason if given.
 * Moving to Applied records the application (see `recordApplication`).
 * Moving back before applying forgets an applied date that has no documents
 * sent with it. Returns the timeline event, or null when the status didn't
 * change.
 */
export async function changeJobStatus(
  change: StatusChange,
): Promise<{ from: JobStatus; to: JobStatus; eventId: string | null }> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status, followUpOn: job.followUpOn })
      .from(job)
      .where(eq(job.id, change.jobId))
      .for("update");
    if (!current) throw new JobNotFoundError();

    const from = current.status;
    const to = change.status;
    if (from === to) return { from, to, eventId: null };

    await tx.update(job).set({ status: to }).where(eq(job.id, change.jobId));
    const [written] = await tx
      .insert(event)
      .values({
        jobId: change.jobId,
        type: "status_changed",
        payload: { from, to, reason: change.reason || null },
      })
      .returning({ id: event.id });

    if (to === "applied") {
      await recordApplication(tx, change.jobId, {
        fresh: BEFORE_APPLYING.includes(from),
        followUpOn: current.followUpOn ?? null,
      });
    } else if (BEFORE_APPLYING.includes(to)) {
      await tx
        .delete(application)
        .where(
          and(
            eq(application.jobId, change.jobId),
            isNull(application.cvDocumentId),
            isNull(application.letterDocumentId),
            isNull(application.answersDocumentId),
          ),
        );
    }
    return { from, to, eventId: written?.id ?? null };
  });
}

/** Remove is for roles not applied to; those live in Applications. */
export class JobRemoveError extends Error {
  constructor() {
    super(
      "A role you applied to stays in Applications, so it can't be removed.",
    );
    this.name = "JobRemoveError";
  }
}

/**
 * Takes a role off the lists: it moves to Removed, which only the Removed
 * tab shows. Its link stays known, so later searches don't bring it back.
 */
export async function removeJob(jobId: string): Promise<{ status: JobStatus }> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status })
      .from(job)
      .where(eq(job.id, jobId))
      .for("update");
    if (!current) throw new JobNotFoundError();
    if (current.status === "removed") return { status: current.status };
    if (!BEFORE_APPLYING.includes(current.status)) throw new JobRemoveError();
    await tx.update(job).set({ status: "removed" }).where(eq(job.id, jobId));
    await tx.insert(event).values({
      jobId,
      type: "status_changed",
      payload: { from: current.status, to: "removed", reason: null },
    });
    return { status: "removed" };
  });
}

/** Puts a removed role back at the status it had before it was removed. */
export async function restoreJob(
  jobId: string,
): Promise<{ status: JobStatus }> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status })
      .from(job)
      .where(eq(job.id, jobId))
      .for("update");
    if (!current) throw new JobNotFoundError();
    if (current.status !== "removed") return { status: current.status };
    const [removal] = await tx
      .select({ type: event.type, payload: event.payload })
      .from(event)
      .where(
        and(
          eq(event.jobId, jobId),
          eq(event.type, "status_changed"),
          sql`${event.payload}->>'to' = 'removed'`,
        ),
      )
      .orderBy(desc(event.at))
      .limit(1);
    const parsed = jobEventSchema.safeParse(removal);
    const before =
      parsed.success && parsed.data.type === "status_changed"
        ? parsed.data.payload.from
        : "new";
    const to: JobStatus = before === "removed" ? "new" : before;
    await tx.update(job).set({ status: to }).where(eq(job.id, jobId));
    await tx.insert(event).values({
      jobId,
      type: "status_changed",
      payload: { from: "removed", to, reason: null },
    });
    return { status: to };
  });
}

/**
 * Records what went out: the applied date and the latest ready version of
 * each document. A fresh application (from before applying) replaces any
 * earlier record, adds the documents to the timeline and sets a follow-up
 * FOLLOW_UP_DAYS later. Moving back to Applied from a later status keeps
 * the record that's there.
 */
async function recordApplication(
  tx: Tx,
  jobId: string,
  { fresh, followUpOn }: { fresh: boolean; followUpOn: string | null },
): Promise<void> {
  const rows = await tx
    .select({ id: document.id, kind: document.kind, version: document.version })
    .from(document)
    .where(and(eq(document.jobId, jobId), isNotNull(document.readyAt)))
    .orderBy(desc(document.version));
  const latest = new Map<DocumentKind, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.kind)) latest.set(row.kind, row);
  const sent = {
    appliedAt: new Date(),
    cvDocumentId: latest.get("cv")?.id ?? null,
    letterDocumentId: latest.get("cover_letter")?.id ?? null,
    answersDocumentId: latest.get("answers")?.id ?? null,
  };

  if (!fresh) {
    await tx
      .insert(application)
      .values({ jobId, ...sent })
      .onConflictDoNothing({ target: application.jobId });
    return;
  }
  await tx
    .insert(application)
    .values({ jobId, ...sent })
    .onConflictDoUpdate({ target: application.jobId, set: sent });
  const documents = (["cv", "cover_letter", "answers"] as const).flatMap(
    (kind) => {
      const row = latest.get(kind);
      return row ? [{ kind, version: row.version }] : [];
    },
  );
  if (documents.length > 0) {
    await tx.insert(event).values({
      jobId,
      type: "documents_sent",
      payload: { documents },
    });
  }
  const today = dayIn(await readOwnerTimeZone(tx));
  await writeFollowUp(tx, jobId, followUpOn, addDays(today, FOLLOW_UP_DAYS));
}
