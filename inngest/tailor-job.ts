import { NonRetriableError, type GetStepTools } from "inngest";

import { BudgetExceededError } from "@/lib/claude/budget";
import {
  checkClaims,
  ClaimCheckError,
  type ClaimItem,
} from "@/lib/claude/claim-check";
import { companySnapshot } from "@/lib/claude/company-snapshot";
import { TailorError, tailorDocuments } from "@/lib/claude/tailor";
import { backedKeywords, postingKeywords } from "@/lib/cvs/keywords";
import { renderCvPdf, renderLetterPdf } from "@/lib/documents/pdf";
import {
  cvView,
  documentText,
  letterDate,
  letterView,
} from "@/lib/documents/view";
import { readSettings } from "@/lib/pipeline/settings";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import {
  failTailoring,
  finishTailoring,
  getDocuments,
  getLatestDocuments,
  getRequestDocuments,
  getSnapshotProfile,
  getTailorInputs,
  getTailorJob,
  saveCompanyBrief,
  saveDocumentPdf,
  saveDocuments,
  setClaimCheck,
  updateTailorState,
  type SavedDocument,
} from "@/lib/pipeline/tailoring";
import { ownerLinks } from "@/lib/schemas/profile";
import { DOCUMENT_KINDS } from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";
import { citedItems, flaggedIds, toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts, profileFactsText } from "@/lib/tailor/facts";

import { inngest } from "./client";
import {
  apiErrorMessage,
  isPermanentApiError,
  permanentOrRetry,
} from "./errors";
import { tailorRequested } from "./events";

/** The profile is missing, so there is nothing to tailor from. */
export class TailorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailorInputError";
  }
}

/** Errors that would fail the same way on a retry. */
const PERMANENT_ERRORS = [TailorError, TailorInputError, BudgetExceededError];

export const UNCHECKED_MESSAGE =
  "Claude couldn't double-check these claims. Read every bullet against your profile before you send it.";

/** For a request on a role that closed or was removed before it started. */
export const STOPPED_MESSAGES: Partial<Record<JobStatus, string>> = {
  listing_closed: "The employer closed the listing, so the kit wasn't written.",
  removed: "You removed the role, so the kit wasn't written.",
};

/** For a document with lines Claude's check gave no verdict on. */
export function missedLinesMessage(count: number): string {
  return `Claude didn't double-check ${count === 1 ? "one line" : `${count} lines`} here. Read every line against your profile before you send it.`;
}

export type TailorSteps = Pick<GetStepTools<typeof inngest>, "run">;

export type TailorOutcome =
  | { status: "succeeded"; documents: number }
  | { status: "skipped"; reason: string };

/**
 * Steps 7–10 of the pipeline for one request: a company snapshot (on the
 * first tailoring only), the documents, the claim check, and the PDFs. Each
 * is its own Inngest step. Steps return ids, never document text, so the
 * owner's data stays out of Inngest's step history.
 */
export async function runTailoring(
  { jobId, requestId }: { jobId: string; requestId: string },
  step: TailorSteps,
): Promise<TailorOutcome> {
  const start = await step.run("start", () => startStep(jobId, requestId));
  if (!start.ok) return { status: "skipped", reason: start.reason };

  // The owner's edit is written and its lines come from the profile or a
  // checked version, so only its PDF is drawn.
  if (start.edit) {
    const saved = await step.run("find-edit", () => editStep(requestId));
    await step.run("render", () => renderStep(jobId, requestId, saved));
    return { status: "succeeded", documents: saved.length };
  }

  if (start.research) {
    // A brief that can't be written doesn't hold up the documents.
    await step
      .run("company-snapshot", () => snapshotStep(jobId, requestId))
      .catch(() => null);
  }

  const written = await step.run("write", () => writeStep(jobId, requestId));
  const ids = written.map((doc) => doc.id);
  await step
    .run("check-claims", () => checkStep(jobId, requestId, ids))
    .catch(() =>
      step.run("check-claims-failed", () =>
        markUnchecked(ids, UNCHECKED_MESSAGE),
      ),
    );
  await step.run("render", () => renderStep(jobId, requestId, written));
  return { status: "succeeded", documents: written.length };
}

/**
 * Marks the request as running, unless a newer one replaced it, or the
 * listing closed or the role was removed in the meantime.
 */
export async function startStep(
  jobId: string,
  requestId: string,
): Promise<
  { ok: true; research: boolean; edit: boolean } | { ok: false; reason: string }
> {
  const role = await getTailorJob(jobId);
  if (!role) throw new NonRetriableError(`No role with id ${jobId}.`);
  const state = role.tailoring;
  if (!state || state.requestId !== requestId) {
    return { ok: false, reason: "A newer request replaced this one." };
  }
  if (state.status !== "queued" && state.status !== "running") {
    return { ok: false, reason: `The request had already ${state.status}.` };
  }
  const stopped = STOPPED_MESSAGES[role.status];
  if (stopped) {
    await failTailoring(jobId, requestId, stopped);
    return { ok: false, reason: stopped };
  }
  // The brief is written once per role, when it's first tailored.
  const edit = state.edit === true;
  const research =
    !edit && state.kinds.length === DOCUMENT_KINDS.length && !role.companyBrief;
  await updateTailorState(jobId, requestId, {
    status: "running",
    stage: research ? "researching" : edit ? "rendering" : "writing",
  });
  return { ok: true, research, edit };
}

/** The version the owner's edit saved, for its PDF. */
export async function editStep(requestId: string): Promise<SavedDocument[]> {
  const saved = await getRequestDocuments(requestId);
  if (saved.length === 0) {
    throw new NonRetriableError("The edited CV isn't there anymore.");
  }
  return saved;
}

/** Step 7: the company snapshot. Returns whether a brief was saved. */
export async function snapshotStep(
  jobId: string,
  requestId: string,
): Promise<boolean> {
  const role = await getTailorJob(jobId);
  if (!role) return false;
  try {
    const { brief } = await companySnapshot(
      { company: role.company, title: role.title, url: role.url },
      jobId,
    );
    if (brief.text === "") return false;
    await saveCompanyBrief(jobId, brief);
    return true;
  } catch (error) {
    // The budget check runs again before the documents, and stops them there.
    if (error instanceof BudgetExceededError) return false;
    if (isPermanentApiError(error)) {
      console.warn(`Company snapshot skipped: ${apiErrorMessage(error)}`);
      return false;
    }
    throw error;
  } finally {
    await updateTailorState(jobId, requestId, { stage: "writing" });
  }
}

/** Step 8: writes the documents and saves them with the code check's flags. */
export async function writeStep(
  jobId: string,
  requestId: string,
): Promise<SavedDocument[]> {
  try {
    const role = await getTailorJob(jobId);
    const state = role?.tailoring;
    if (!role || !state || state.requestId !== requestId) {
      throw new NonRetriableError("A newer request replaced this one.");
    }
    const inputs = await getTailorInputs();
    if (!inputs) {
      throw new TailorInputError(
        "Save your profile first: the documents are written from it.",
      );
    }

    // A note asks for changes to the current version, so Claude gets it.
    const current = state.note
      ? await Promise.all(
          (await getLatestDocuments(jobId, state.kinds)).map(async (doc) => ({
            kind: doc.kind,
            text: documentText(
              doc.content,
              doc.claimFlags,
              (await getSnapshotProfile(doc.snapshotId)) ?? inputs.profile,
            ),
          })),
        )
      : [];

    const { output } = await tailorDocuments(
      profileFactsText(inputs.profile, inputs.answers, inputs.preferences),
      {
        title: role.title,
        company: role.company,
        facts: role.facts,
        description: role.description,
        brief: role.companyBrief,
        keywords: backedKeywords(
          postingKeywords(role, inputs.profile),
          inputs.profile,
        ),
      },
      {
        kinds: state.kinds,
        note: state.note,
        current,
        questions: state.questions,
      },
      jobId,
    );
    const facts = factIndex(
      profileFacts(inputs.profile, inputs.answers, inputs.preferences),
    );
    const documents = toDocuments(output, state.kinds, inputs.profile, facts);
    const saved = await saveDocuments(
      jobId,
      requestId,
      inputs.snapshotId,
      state.note,
      documents,
    );
    await updateTailorState(jobId, requestId, { stage: "checking" });
    return saved;
  } catch (error) {
    throw permanentOrRetry(error, PERMANENT_ERRORS);
  }
}

/**
 * Step 9, Claude's half: checks every claim the code check passed, against
 * the facts it cites. A check that can't run leaves the documents marked as
 * unchecked rather than failing them.
 */
export async function checkStep(
  jobId: string,
  requestId: string,
  documentIds: string[],
): Promise<{ flagged: number }> {
  const docs = await getDocuments(documentIds);
  const [inputs, role] = await Promise.all([
    getTailorInputs(),
    getTailorJob(jobId),
  ]);
  const snapshot = docs[0]
    ? await getSnapshotProfile(docs[0].snapshotId)
    : null;
  if (!snapshot || !role) return { flagged: 0 };
  const facts = factIndex(
    profileFacts(
      snapshot,
      inputs?.answers ?? null,
      inputs?.preferences ?? null,
    ),
  );

  const items: ClaimItem[] = docs.flatMap((doc) => {
    const flagged = flaggedIds(doc.claimFlags);
    return citedItems(doc.content)
      .filter((item) => !flagged.has(item.id))
      .map((item) => ({ key: `${doc.kind}/${item.id}`, item }));
  });

  let flags: Awaited<ReturnType<typeof checkClaims>>["flags"];
  let unchecked: string[];
  try {
    ({ flags, unchecked } = await checkClaims(
      items,
      facts,
      { title: role.title, company: role.company, facts: role.facts },
      jobId,
    ));
  } catch (error) {
    if (
      error instanceof BudgetExceededError ||
      error instanceof ClaimCheckError ||
      isPermanentApiError(error)
    ) {
      const message =
        error instanceof BudgetExceededError
          ? `${UNCHECKED_MESSAGE} ${error.message}`
          : UNCHECKED_MESSAGE;
      await markUnchecked(documentIds, message);
      await updateTailorState(jobId, requestId, { stage: "rendering" });
      return { flagged: 0 };
    }
    throw error;
  }

  const checkedAt = new Date().toISOString();
  for (const doc of docs) {
    const missed = unchecked.filter((key) => key.startsWith(`${doc.kind}/`));
    const own = flags
      .filter((flag) => flag.key.startsWith(`${doc.kind}/`))
      .map(({ itemId, kind, reason, text }) => ({
        itemId,
        kind,
        reason,
        text,
      }));
    await setClaimCheck(doc.id, {
      flags: [...(doc.claimFlags?.flags ?? []), ...own],
      checkedAt,
      checkError: missed.length > 0 ? missedLinesMessage(missed.length) : null,
    });
  }
  await updateTailorState(jobId, requestId, { stage: "rendering" });
  return { flagged: flags.length };
}

/** Keeps the code check's flags and records why Claude's check didn't run. */
export async function markUnchecked(
  documentIds: string[],
  message: string,
): Promise<void> {
  for (const doc of await getDocuments(documentIds)) {
    await setClaimCheck(doc.id, {
      flags: doc.claimFlags?.flags ?? [],
      checkedAt: null,
      checkError: message,
    });
  }
}

/**
 * Step 10: renders the CV and cover letter PDFs, then makes the documents
 * the apply kit's latest and moves a shortlisted role to Ready. The links
 * at the top are the owner's as saved now, standard answers first. Both
 * are drawn in the design set in Settings, unless the owner picked another
 * for the CV in the editor; the letter then matches it.
 */
export async function renderStep(
  jobId: string,
  requestId: string,
  saved: SavedDocument[],
): Promise<void> {
  const [role, inputs, timeZone, settings] = await Promise.all([
    getTailorJob(jobId),
    getTailorInputs(),
    readOwnerTimeZone(),
    readSettings(),
  ]);
  if (!role) throw new NonRetriableError(`No role with id ${jobId}.`);
  const docs = await getDocuments(saved.map((doc) => doc.id));
  const picked = docs.find((doc) => doc.content.kind === "cv")?.content;
  const template =
    (picked?.kind === "cv" ? picked.template : undefined) ??
    settings.cvTemplate;
  for (const doc of docs) {
    if (doc.content.kind === "answers") continue;
    const profile = await getSnapshotProfile(doc.snapshotId);
    if (!profile) throw new NonRetriableError("The profile snapshot is gone.");
    const links = ownerLinks(profile.links, inputs?.answers?.links ?? null);
    const bytes =
      doc.content.kind === "cv"
        ? await renderCvPdf(
            cvView(doc.content, doc.claimFlags, profile, links),
            template,
          )
        : await renderLetterPdf(
            letterView(
              doc.content,
              doc.claimFlags,
              profile,
              role.company,
              links,
            ),
            letterDate(timeZone),
            template,
          );
    await saveDocumentPdf(
      jobId,
      doc.id,
      bytes,
      links.map(({ label, url }) => ({ label, url })),
    );
  }
  await finishTailoring(
    jobId,
    requestId,
    saved,
    role.tailoring?.note ?? null,
    role.tailoring?.edit === true,
  );
}

/** Tailors one role for each `job/tailor.requested` event. */
export const tailorJob = inngest.createFunction(
  {
    id: "tailor-job",
    name: "Tailor an application",
    triggers: [tailorRequested],
    // One request per role at a time; the apply kit refuses a second anyway.
    concurrency: { key: "event.data.jobId", limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId, requestId } = event.data.event.data;
      await failTailoring(jobId, requestId, error.message.slice(0, 500));
    },
  },
  async ({ event, step }) => runTailoring(event.data, step),
);
