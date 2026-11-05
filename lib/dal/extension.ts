import "server-only";

import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { document, job, profile } from "@/db/schema";
import {
  attachmentName,
  planFill,
  words,
  type FillKit,
} from "@/lib/extension/fill";
import { postingLink } from "@/lib/jobs/canonical-url";
import {
  answersSchema,
  defaultAnswers,
  ownerLink,
  ownerLinks,
} from "@/lib/schemas/profile";
import type { FillFileKind, FillRequest } from "@/lib/schemas/extension";
import { isTailoringActive, TAILORABLE_STATUSES } from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";

import {
  getApplyKit,
  markApplied,
  requestTailoring,
  TailorRequestError,
} from "./apply-kit";
import { db } from "./db";
import { JobNotFoundError } from "./jobs";
import { getCurrentUser } from "./session";

// The app's side of the form filler (the Chrome extension in extension/).
// The extension calls these through /api/extension with the owner's session
// cookie, as the app's own pages do.

/** Roles whose application form the filler can fill. */
const FILLABLE_STATUSES = [
  "shortlisted",
  "ready",
  "applied",
] as const satisfies readonly JobStatus[];

export type ExtensionRole = {
  id: string;
  company: string;
  title: string;
  status: JobStatus;
  /** A tailored CV is ready. */
  hasKit: boolean;
};

/**
 * The role whose posting or application form is at `url`, and the roles the
 * owner could be applying to, newest first, for when none matches.
 */
export async function getRolesForPage(
  url: string,
): Promise<{ match: string | null; roles: ExtensionRole[] }> {
  await getCurrentUser();
  const rows = await db
    .select({
      id: job.id,
      company: job.company,
      title: job.title,
      status: job.status,
      dedupeKey: job.dedupeKey,
      applyUrl: job.applyUrl,
    })
    .from(job)
    .where(inArray(job.status, [...FILLABLE_STATUSES]))
    .orderBy(desc(job.updatedAt))
    .limit(30);
  const withCv = new Set(
    rows.length === 0
      ? []
      : (
          await db
            .selectDistinct({ jobId: document.jobId })
            .from(document)
            .where(
              and(
                inArray(
                  document.jobId,
                  rows.map((row) => row.id),
                ),
                eq(document.kind, "cv"),
                isNotNull(document.readyAt),
              ),
            )
        ).map((row) => row.jobId),
  );
  const key = postingLink(url)?.dedupeKey;
  const match = key
    ? rows.find(
        (row) =>
          row.dedupeKey === key ||
          (row.applyUrl !== null &&
            postingLink(row.applyUrl)?.dedupeKey === key),
      )
    : undefined;
  return {
    match: match?.id ?? null,
    roles: rows.map((row) => ({
      id: row.id,
      company: row.company,
      title: row.title,
      status: row.status,
      hasKit: withCv.has(row.id),
    })),
  };
}

/** What the extension does with one form. */
export type FillResponse = {
  values: { key: string; value: string }[];
  /** PDFs to attach, each fetched from the app by the extension. */
  files: { key: string; url: string; filename: string }[];
  left: string[];
  /**
   * Claude is writing answers to the form's own questions: the extension
   * waits for the request to finish, then asks again.
   */
  writing: string | null;
};

/**
 * Plans the filling of a form for a role, from the profile, the standard
 * answers and the role's apply kit. When the form asks questions nothing
 * answers yet, Claude is asked to answer the form's questions (the answers
 * document is tailored again), once per set of questions; the caller sends
 * the returned request to Inngest.
 */
export async function planFormFill(
  request: FillRequest,
): Promise<FillResponse & { requestId: string | null }> {
  await getCurrentUser();
  const [kit, [row]] = await Promise.all([
    getApplyKit(request.jobId),
    db
      .select({ data: profile.data, answers: profile.answers })
      .from(profile)
      .where(eq(profile.id, 1)),
  ]);
  if (!kit) throw new JobNotFoundError();
  const data = row?.data ?? null;
  const parsed = answersSchema.safeParse(row?.answers);
  const answers = parsed.success ? parsed.data : defaultAnswers;
  const current = data?.experience.find((role) => role.current);
  const links = ownerLinks(data?.links ?? [], answers.links);

  const fillKit: FillKit = {
    name: data?.basics.name ?? "",
    email: data?.basics.email ?? "",
    phone: data?.basics.phone ?? "",
    location: data?.basics.location ?? "",
    currentCompany: current?.company ?? "",
    currentTitle: current?.title ?? "",
    links: {
      linkedin: ownerLink(links, "linkedin"),
      github: ownerLink(links, "github"),
      portfolio: ownerLink(links, "portfolio"),
      other: (data?.links ?? []).map(({ label, url }) => ({ label, url })),
    },
    noticePeriod: answers.noticePeriod,
    workAuthorization: answers.workAuthorization,
    answers: [
      ...answers.extra.map(({ question, answer }) => ({
        question,
        answer,
        saved: true,
      })),
      ...(kit.answers?.items ?? [])
        .filter((item) => item.answer && !item.flag)
        .map((item) => ({
          question: item.question,
          answer: item.answer,
          saved: item.fromStandard,
        })),
    ],
    letterText: kit.letter?.text ?? null,
    files: [
      ...(kit.cv?.document.pdfUrl ? (["cv"] as const) : []),
      ...(kit.letter?.document.pdfUrl ? (["cover_letter"] as const) : []),
    ],
  };
  const plan = planFill(request.fields, fillKit);

  const pdfs: Record<FillFileKind, { id: string; url: string | null } | null> =
    {
      cv: kit.cv
        ? { id: kit.cv.document.id, url: kit.cv.document.pdfUrl }
        : null,
      cover_letter: kit.letter
        ? { id: kit.letter.document.id, url: kit.letter.document.pdfUrl }
        : null,
    };
  const files = plan.files.flatMap(({ key, kind }) => {
    const pdf = pdfs[kind];
    return pdf?.url
      ? [
          {
            key,
            url: pdf.url,
            filename: attachmentName(fillKit.name, kind),
          },
        ]
      : [];
  });

  const response = {
    values: plan.values,
    files,
    left: plan.left,
    writing: null as string | null,
    requestId: null as string | null,
  };
  if (plan.questions.length === 0) return response;

  // Questions Claude was already asked and couldn't answer are the owner's.
  const asked = new Set(
    (kit.tailoring?.questions ?? []).map((question) =>
      words(question.question),
    ),
  );
  const fresh = plan.questions.filter(
    (question) => !asked.has(words(question.question)),
  );
  if (isTailoringActive(kit.tailoring)) {
    return { ...response, writing: kit.tailoring?.requestId ?? null };
  }
  const tailorable = (TAILORABLE_STATUSES as readonly JobStatus[]).includes(
    kit.job.status,
  );
  if (fresh.length > 0 && tailorable) {
    try {
      const requestId = await requestTailoring({
        jobId: request.jobId,
        kinds: ["answers"],
        note: "",
        questions: plan.asked.map(({ question, options }) => ({
          question,
          options,
        })),
      });
      return { ...response, writing: requestId, requestId };
    } catch (error) {
      if (!(error instanceof TailorRequestError)) throw error;
    }
  }
  return {
    ...response,
    left: [...response.left, ...plan.questions.map((question) => question.key)],
  };
}

/** How the role's latest tailoring request stands, while the extension waits. */
export async function getTailoringStatus(
  jobId: string,
): Promise<{ requestId: string | null; done: boolean }> {
  await getCurrentUser();
  const [row] = await db
    .select({ tailoring: job.tailoring })
    .from(job)
    .where(eq(job.id, jobId));
  if (!row) throw new JobNotFoundError();
  return {
    requestId: row.tailoring?.requestId ?? null,
    done: !isTailoringActive(row.tailoring),
  };
}

/**
 * The owner submitted the form: the role moves to Applied with the latest
 * documents, as Mark as applied does. A role already applied stays as it is.
 */
export async function markSubmitted(jobId: string): Promise<boolean> {
  await getCurrentUser();
  const [row] = await db
    .select({ status: job.status })
    .from(job)
    .where(
      and(
        eq(job.id, jobId),
        or(eq(job.status, "shortlisted"), eq(job.status, "ready")),
      ),
    );
  if (!row) return false;
  await markApplied(jobId);
  return true;
}
