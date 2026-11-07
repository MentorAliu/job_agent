import "server-only";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  application,
  document,
  file,
  job,
  llmCall,
  profile,
  profileSnapshot,
} from "@/db/schema";
import {
  cvText,
  keywordCoverage,
  postingKeywords,
  profileText,
  skillsForKeywords,
  type KeywordMatch,
} from "@/lib/cvs/keywords";
import { renderCvDocx, renderLetterDocx } from "@/lib/documents/docx";
import {
  answersView,
  cvDiff,
  cvView,
  letterDate,
  letterText,
  letterView,
  withSavedAnswers,
  type AnswerView,
  type CvDiff,
  type CvView,
  type LetterView,
} from "@/lib/documents/view";
import { readSettings } from "@/lib/pipeline/settings";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import { getStorage } from "@/lib/storage";
import {
  answersSchema,
  defaultAnswers,
  ownerLink,
  ownerLinks,
  type Answers,
  type MasterProfile,
} from "@/lib/schemas/profile";
import {
  DOCUMENT_KINDS,
  isLostTailoring,
  isTailoringActive,
  LOST_TAILORING_MESSAGE,
  newTailorState,
  TAILORABLE_STATUSES,
  type ClaimCheck,
  type ClaimFlag,
  type CompanyBrief,
  type DocumentKind,
  type FormQuestion,
  type TailorRequest,
  type TailorState,
} from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";

import { db } from "./db";
import {
  changeJobStatus,
  JobNotFoundError,
  salaryView,
  type JobListRow,
} from "./jobs";
import { getCurrentUser } from "./session";

// The apply kit (`/jobs/[id]`): the tailored documents as they'll be sent,
// with their claim check, the diff against the master CV, and what went out
// with the application. Starting a tailoring request lives here too.

export type KitDocument = {
  id: string;
  kind: DocumentKind;
  version: number;
  readyAt: string;
  /** The owner's note, when this version was regenerated with one. */
  note: string | null;
  /** The owner made this version in the CV editor. */
  edited: boolean;
  pdfUrl: string | null;
  flags: ClaimFlag[];
  /** When Claude checked the claims, or null when only the code checked. */
  checkedAt: string | null;
  checkError: string | null;
};

export type SentDocument = { kind: DocumentKind; version: number };

export type ApplyKit = {
  job: {
    id: string;
    title: string;
    company: string;
    url: string;
    applyUrl: string | null;
    status: JobStatus;
    score: number | null;
    workplace: JobListRow["workplace"];
    places: string[];
    salary: JobListRow["salary"];
    /** The posting's own words on using AI, shown at the top. */
    aiPolicy: string | null;
    applicationRules: string[];
    deadline: string | null;
    /** The owner added it on the Roles page, so the app never picks it. */
    addedByOwner: boolean;
  };
  /** The latest request. A lost one reads as failed. */
  tailoring: TailorState | null;
  canTailor: boolean;
  brief: CompanyBrief | null;
  cv: {
    document: KitDocument;
    view: CvView;
    diff: CvDiff;
    /**
     * The posting's keywords and where each shows up, against the profile
     * as it is now, so a skill added since the CV was written counts.
     */
    keywords: KeywordMatch[];
    /** Profile skills that would put a missing keyword on this CV. */
    skillsToAdd: { id: string; name: string }[];
  } | null;
  letter: { document: KitDocument; view: LetterView; text: string } | null;
  answers: { document: KitDocument; items: AnswerView[] } | null;
  /** The owner's details and saved answers, for the form's usual fields. */
  standardAnswers: { label: string; value: string }[];
  /** Standard answers the owner hasn't saved yet. */
  missingAnswers: string[];
  /** What tailoring this role has cost: the company research, the writing and the checks, in USD. */
  costUsd: number;
  application: {
    appliedAt: string;
    followUpOn: string | null;
    documents: SentDocument[];
  } | null;
};

/** The Claude calls a kit's cost counts. Scoring the role isn't one of them. */
const KIT_STAGES = ["company_snapshot", "tailor", "claim_check"] as const;

export class TailorRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailorRequestError";
  }
}

function kitDocument(row: {
  id: string;
  kind: DocumentKind;
  version: number;
  readyAt: Date | null;
  note: string | null;
  edited: boolean;
  pdfFileId: string | null;
  claimFlags: ClaimCheck | null;
}): KitDocument {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    readyAt: (row.readyAt ?? new Date(0)).toISOString(),
    note: row.note,
    edited: row.edited,
    pdfUrl: row.pdfFileId ? `/api/documents/${row.id}/pdf` : null,
    flags: row.claimFlags?.flags ?? [],
    checkedAt: row.claimFlags?.checkedAt ?? null,
    checkError: row.claimFlags?.checkError ?? null,
  };
}

/** A lost request reads as failed, so the owner can start another. */
function shownState(state: TailorState | null): TailorState | null {
  if (!state || !isLostTailoring(state)) return state;
  return { ...state, status: "failed", error: LOST_TAILORING_MESSAGE };
}

export async function getApplyKit(jobId: string): Promise<ApplyKit | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.canonicalUrl,
      applyUrl: job.applyUrl,
      status: job.status,
      score: job.score,
      addedByOwner: job.addedByOwner,
      facts: job.facts,
      description: job.descriptionMd,
      followUpOn: job.followUpOn,
      brief: job.companyBrief,
      tailoring: job.tailoring,
      appliedAt: application.appliedAt,
      sentIds: sql<
        (string | null)[]
      >`array[${application.cvDocumentId}, ${application.letterDocumentId}, ${application.answersDocumentId}]`,
    })
    .from(job)
    .leftJoin(application, eq(application.jobId, job.id))
    .where(eq(job.id, jobId));
  if (!row) return null;

  const [documents, [current], [spent]] = await Promise.all([
    db
      .select({
        id: document.id,
        kind: document.kind,
        version: document.version,
        content: document.content,
        claimFlags: document.claimFlags,
        snapshotId: document.snapshotId,
        note: document.note,
        edited: document.edited,
        readyAt: document.readyAt,
        pdfFileId: document.pdfFileId,
        headerLinks: document.headerLinks,
      })
      .from(document)
      .where(and(eq(document.jobId, jobId), isNotNull(document.readyAt)))
      .orderBy(desc(document.version)),
    db
      .select({ data: profile.data, answers: profile.answers })
      .from(profile)
      .where(eq(profile.id, 1)),
    db
      .select({
        costUsd: sql<number>`coalesce(sum(${llmCall.costUsd}), 0)`.mapWith(
          Number,
        ),
      })
      .from(llmCall)
      .where(
        and(eq(llmCall.jobId, jobId), inArray(llmCall.stage, [...KIT_STAGES])),
      ),
  ]);
  const answers = parseAnswers(current?.answers);

  const latest = new Map<DocumentKind, (typeof documents)[number]>();
  for (const doc of documents)
    if (!latest.has(doc.kind)) latest.set(doc.kind, doc);

  // Each document is shown against the profile it was written from.
  const snapshotIds = [
    ...new Set([...latest.values()].map((d) => d.snapshotId)),
  ];
  const snapshots = new Map<string, MasterProfile>(
    snapshotIds.length === 0
      ? []
      : (
          await db
            .select({
              id: profileSnapshot.id,
              data: profileSnapshot.profileData,
            })
            .from(profileSnapshot)
            .where(inArray(profileSnapshot.id, snapshotIds))
        ).map((snapshot) => [snapshot.id, snapshot.data]),
  );
  const withProfile = (kind: DocumentKind) => {
    const doc = latest.get(kind);
    const snapshot = doc && snapshots.get(doc.snapshotId);
    return doc && snapshot ? { doc, snapshot } : null;
  };

  const cv = withProfile("cv");
  const letter = withProfile("cover_letter");
  const answerDoc = withProfile("answers");
  const sent = new Set(row.sentIds?.filter(Boolean));

  return {
    job: {
      id: row.id,
      title: row.title,
      company: row.company,
      url: row.url,
      applyUrl: row.applyUrl,
      status: row.status,
      score: row.score,
      workplace: row.facts?.location.workplace ?? null,
      places:
        row.facts && row.facts.location.placesAre !== "team_locations"
          ? row.facts.location.allowed
          : [],
      salary: salaryView(row.facts),
      aiPolicy: row.facts?.aiPolicy || null,
      applicationRules: row.facts?.applicationRules ?? [],
      deadline: row.facts?.deadline || null,
      addedByOwner: row.addedByOwner ?? false,
    },
    tailoring: shownState(row.tailoring),
    canTailor: (TAILORABLE_STATUSES as readonly JobStatus[]).includes(
      row.status,
    ),
    brief: row.brief,
    cv:
      cv && cv.doc.content.kind === "cv"
        ? (() => {
            const view = cvView(
              cv.doc.content,
              cv.doc.claimFlags,
              cv.snapshot,
              cv.doc.headerLinks ?? undefined,
            );
            // The CV as it was written, against the profile as it is now:
            // a skill added since shows as one the CV can take.
            const now = current?.data ?? cv.snapshot;
            const keywords = keywordCoverage(
              postingKeywords(
                {
                  title: row.title,
                  facts: row.facts,
                  description: row.description ?? null,
                },
                now,
              ),
              cvText(view),
              profileText(now),
            );
            return {
              document: kitDocument(cv.doc),
              view,
              diff: cvDiff(cv.doc.content, cv.doc.claimFlags, cv.snapshot),
              keywords,
              skillsToAdd: skillsForKeywords(
                keywords,
                now,
                cv.doc.content.skillIds,
              ),
            };
          })()
        : null,
    letter:
      letter && letter.doc.content.kind === "cover_letter"
        ? (() => {
            const view = letterView(
              letter.doc.content,
              letter.doc.claimFlags,
              letter.snapshot,
              row.company,
              letter.doc.headerLinks ?? undefined,
            );
            return {
              document: kitDocument(letter.doc),
              view,
              text: letterText(view),
            };
          })()
        : null,
    answers:
      answerDoc && answerDoc.doc.content.kind === "answers"
        ? {
            document: kitDocument(answerDoc.doc),
            items: withSavedAnswers(
              answersView(answerDoc.doc.content, answerDoc.doc.claimFlags),
              answers,
            ),
          }
        : null,
    ...standardAnswers(current?.data ?? null, answers),
    costUsd: spent?.costUsd ?? 0,
    application: row.appliedAt
      ? {
          appliedAt: row.appliedAt.toISOString(),
          followUpOn: row.followUpOn,
          documents: DOCUMENT_KINDS.flatMap((kind) => {
            const doc = documents.find(
              (d) => d.kind === kind && sent.has(d.id),
            );
            return doc ? [{ kind, version: doc.version }] : [];
          }),
        }
      : null,
  };
}

function parseAnswers(raw: unknown): Answers {
  const parsed = answersSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultAnswers;
}

function standardAnswers(
  data: MasterProfile | null,
  answers: Answers,
): Pick<ApplyKit, "standardAnswers" | "missingAnswers"> {
  const filled: { label: string; value: string }[] = [];
  const missing: string[] = [];
  const add = (label: string, value: string, required = false) => {
    if (value.trim()) filled.push({ label, value: value.trim() });
    else if (required) missing.push(label);
  };
  if (data) {
    add("Name", data.basics.name);
    add("Email", data.basics.email);
    add("Phone", data.basics.phone);
    add("Location", data.basics.location);
  }
  add("Notice period", answers.noticePeriod, true);
  add("Work authorization", answers.workAuthorization, true);
  const links = ownerLinks(data?.links ?? [], answers.links);
  add("LinkedIn", ownerLink(links, "linkedin"));
  add("GitHub", ownerLink(links, "github"));
  add("Portfolio", ownerLink(links, "portfolio"), true);
  for (const extra of answers.extra) add(extra.question, extra.answer);
  return { standardAnswers: filled, missingAnswers: missing };
}

/**
 * Starts a tailoring request: all three documents, or some of them with the
 * owner's note, or the answers to an application form's own questions (from
 * the form filler). Returns the request id for the Inngest event. With
 * `firstOnly`, a role that already has documents or a request going is left
 * alone and null comes back: that's how shortlisting starts tailoring.
 */
export async function requestTailoring(
  request: TailorRequest & { questions?: FormQuestion[] },
  options?: { firstOnly?: false },
): Promise<string>;
export async function requestTailoring(
  request: TailorRequest,
  options: { firstOnly: true },
): Promise<string | null>;
export async function requestTailoring(
  request: TailorRequest & { questions?: FormQuestion[] },
  { firstOnly = false }: { firstOnly?: boolean } = {},
): Promise<string | null> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: job.status, tailoring: job.tailoring })
      .from(job)
      .where(eq(job.id, request.jobId))
      .for("update");
    if (!current) throw new JobNotFoundError();
    if (
      !(TAILORABLE_STATUSES as readonly JobStatus[]).includes(current.status)
    ) {
      if (firstOnly) return null;
      throw new TailorRequestError("Shortlist the role before tailoring it.");
    }
    if (isTailoringActive(current.tailoring)) {
      if (firstOnly) return null;
      throw new TailorRequestError("Claude is already tailoring this role.");
    }
    if (firstOnly) {
      const [existing] = await tx
        .select({ id: document.id })
        .from(document)
        .where(eq(document.jobId, request.jobId))
        .limit(1);
      if (existing) return null;
    }
    const [snapshot] = await tx
      .select({ id: profileSnapshot.id })
      .from(profileSnapshot)
      .limit(1);
    if (!snapshot) {
      throw new TailorRequestError(
        "Save your profile first: the documents are written from it.",
      );
    }

    const state: TailorState = {
      ...newTailorState(request.kinds, request.note),
      ...(request.questions?.length ? { questions: request.questions } : {}),
    };
    await tx
      .update(job)
      .set({ tailoring: state })
      .where(eq(job.id, request.jobId));
    return state.requestId;
  });
}

/** Ends a request whose Inngest event couldn't be sent. */
export async function markTailoringFailed(
  jobId: string,
  requestId: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await db
    .update(job)
    .set({
      tailoring: sql`${job.tailoring} || ${JSON.stringify({
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      })}::jsonb`,
    })
    .where(
      and(
        eq(job.id, jobId),
        sql`${job.tailoring}->>'requestId' = ${requestId}`,
      ),
    );
}

/**
 * Mark as applied: the role moves to Applied, which records the latest
 * version of each document and sets the follow-up. Returns what was sent.
 */
export async function markApplied(
  jobId: string,
): Promise<NonNullable<ApplyKit["application"]>> {
  await changeJobStatus({ jobId, status: "applied", reason: "" });
  const [row] = await db
    .select({
      appliedAt: application.appliedAt,
      followUpOn: job.followUpOn,
      ids: sql<
        (string | null)[]
      >`array[${application.cvDocumentId}, ${application.letterDocumentId}, ${application.answersDocumentId}]`,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.jobId, jobId));
  if (!row) throw new JobNotFoundError();
  const ids = row.ids.filter((id): id is string => id !== null);
  const sent =
    ids.length === 0
      ? []
      : await db
          .select({ kind: document.kind, version: document.version })
          .from(document)
          .where(inArray(document.id, ids));
  return {
    appliedAt: row.appliedAt.toISOString(),
    followUpOn: row.followUpOn,
    documents: DOCUMENT_KINDS.flatMap((kind) =>
      sent.filter((doc) => doc.kind === kind),
    ),
  };
}

const FILE_KINDS: Record<DocumentKind, string> = {
  cv: "CV",
  cover_letter: "Cover letter",
  answers: "Answers",
};

/** A document's PDF and a file name for the download. */
export async function getDocumentPdf(
  documentId: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string } | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      kind: document.kind,
      version: document.version,
      storageKey: file.storageKey,
      company: job.company,
      name: sql<
        string | null
      >`${profileSnapshot.profileData}->'basics'->>'name'`,
    })
    .from(document)
    .innerJoin(file, eq(file.id, document.pdfFileId))
    .innerJoin(job, eq(job.id, document.jobId))
    .innerJoin(profileSnapshot, eq(profileSnapshot.id, document.snapshotId))
    .where(eq(document.id, documentId));
  if (!row) return null;
  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) return null;
  return {
    bytes: new Uint8Array(bytes),
    filename: `${[row.name, FILE_KINDS[row.kind], row.company]
      .filter(Boolean)
      .join(" - ")} v${row.version}.pdf`,
  };
}

/**
 * A tailored CV or cover letter as a Word file, made from the same content
 * and links as its PDF, in its design. The letter keeps the date it was
 * written. Null for answers, or a document that isn't ready.
 */
export async function getDocumentDocx(
  documentId: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string } | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      content: document.content,
      claimFlags: document.claimFlags,
      headerLinks: document.headerLinks,
      version: document.version,
      readyAt: document.readyAt,
      company: job.company,
      profile: profileSnapshot.profileData,
    })
    .from(document)
    .innerJoin(job, eq(job.id, document.jobId))
    .innerJoin(profileSnapshot, eq(profileSnapshot.id, document.snapshotId))
    .where(and(eq(document.id, documentId), isNotNull(document.readyAt)));
  if (!row || row.content.kind === "answers") return null;
  const [settings, timeZone] = await Promise.all([
    readSettings(),
    readOwnerTimeZone(),
  ]);
  const links = row.headerLinks ?? undefined;
  const filename = (kind: DocumentKind) =>
    `${[row.profile.basics.name, FILE_KINDS[kind], row.company]
      .filter(Boolean)
      .join(" - ")} v${row.version}.docx`;
  if (row.content.kind === "cv") {
    return {
      bytes: await renderCvDocx(
        cvView(row.content, row.claimFlags, row.profile, links),
        row.content.template ?? settings.cvTemplate,
      ),
      filename: filename("cv"),
    };
  }
  return {
    bytes: await renderLetterDocx(
      letterView(row.content, row.claimFlags, row.profile, row.company, links),
      letterDate(timeZone, row.readyAt ?? new Date()),
      settings.cvTemplate,
    ),
    filename: filename("cover_letter"),
  };
}
