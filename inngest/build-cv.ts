import { NonRetriableError, type GetStepTools } from "inngest";

import { BuildCvError, writeCv } from "@/lib/claude/build-cv";
import { BudgetExceededError } from "@/lib/claude/budget";
import {
  checkClaims,
  ClaimCheckError,
  type ClaimItem,
} from "@/lib/claude/claim-check";
import { fitToPages } from "@/lib/cvs/fit";
import { builtCvView } from "@/lib/cvs/view";
import { pdfPageCount, renderCvPdf } from "@/lib/documents/pdf";
import {
  failCvBuild,
  getCvBuild,
  saveCvContent,
  saveCvPdf,
  setCvClaimCheck,
} from "@/lib/pipeline/cvs";
import { getSnapshotProfile, getTailorInputs } from "@/lib/pipeline/tailoring";
import { CV_LENGTH_PAGES, MAX_JOB_KEYWORDS } from "@/lib/schemas/cv-builder";
import { LEGACY_CV_TEMPLATE } from "@/lib/schemas/cv-template";
import { ownerLinks } from "@/lib/schemas/profile";
import { citedItems, flaggedIds, toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts, profileFactsText } from "@/lib/tailor/facts";

import { inngest } from "./client";
import { isPermanentApiError, permanentOrRetry } from "./errors";
import { cvBuildRequested } from "./events";
import { missedLinesMessage, UNCHECKED_MESSAGE } from "./tailor-job";

/** The profile snapshot the CV was asked from is gone. */
export class CvInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvInputError";
  }
}

/** Errors that would fail the same way on a retry. */
const PERMANENT_ERRORS = [BuildCvError, CvInputError, BudgetExceededError];

export type CvBuildSteps = Pick<GetStepTools<typeof inngest>, "run">;

/** The profile a build was asked from, and the facts it can cite. */
async function buildInputs(snapshotId: string) {
  const [profile, inputs] = await Promise.all([
    getSnapshotProfile(snapshotId),
    getTailorInputs(),
  ]);
  if (!profile) {
    throw new CvInputError("The profile this CV was built from is gone.");
  }
  const answers = inputs?.answers ?? null;
  const preferences = inputs?.preferences ?? null;
  return {
    profile,
    text: profileFactsText(profile, answers, preferences),
    facts: factIndex(profileFacts(profile, answers, preferences)),
  };
}

/**
 * One built CV: Claude writes it from the profile, the claims are checked
 * as a tailored CV's are, and the PDF is drawn to the length asked for. Each
 * is its own Inngest step, and steps return no CV text, so the owner's data
 * stays out of Inngest's step history.
 */
export async function runCvBuild(
  { cvId }: { cvId: string },
  step: CvBuildSteps,
): Promise<{ status: "ready" | "skipped" }> {
  const written = await step.run("write", () => writeStep(cvId));
  if (!written) return { status: "skipped" };
  await step
    .run("check-claims", () => checkStep(cvId))
    .catch(() =>
      step.run("check-claims-failed", () =>
        markUnchecked(cvId, UNCHECKED_MESSAGE),
      ),
    );
  await step.run("render", () => renderStep(cvId));
  return { status: "ready" };
}

/**
 * Writes the CV and saves it with the code check's flags. Returns false
 * when there's nothing to do: the CV is gone or already failed. A retried
 * step finds the CV it already wrote and doesn't ask Claude again.
 */
export async function writeStep(cvId: string): Promise<boolean> {
  try {
    const build = await getCvBuild(cvId);
    if (!build || build.status === "failed") return false;
    if (build.status !== "writing") return true;

    const { profile, text, facts } = await buildInputs(build.snapshotId);
    const skillNames = new Map(
      profile.skills.map((skill) => [skill.id, skill.name]),
    );
    const { output } = await writeCv(text, build.request, skillNames);
    const [cv] = toDocuments(
      { cv: output, coverLetter: { paragraphs: [] }, answers: [] },
      ["cv"],
      profile,
      facts,
    );
    if (cv.content.kind !== "cv") throw new Error("Expected a CV.");
    const keywords = build.request.jobText
      ? [
          ...new Set(
            output.jobKeywords.map((term) => term.trim()).filter(Boolean),
          ),
        ].slice(0, MAX_JOB_KEYWORDS)
      : [];
    await saveCvContent(cvId, cv.content, keywords, {
      flags: cv.flags,
      checkedAt: null,
      checkError: null,
    });
    return true;
  } catch (error) {
    throw permanentOrRetry(error, PERMANENT_ERRORS);
  }
}

/**
 * Claude's half of the claim check, on every line the code check passed. A
 * check that can't run leaves the CV marked as unchecked rather than
 * failing it.
 */
export async function checkStep(cvId: string): Promise<{ flagged: number }> {
  const build = await getCvBuild(cvId);
  if (!build?.content || build.status !== "checking") return { flagged: 0 };
  const { facts } = await buildInputs(build.snapshotId);
  const flagged = flaggedIds(build.claimFlags);
  const items: ClaimItem[] = citedItems(build.content)
    .filter((item) => !flagged.has(item.id))
    .map((item) => ({ key: `cv/${item.id}`, item }));

  let result: Awaited<ReturnType<typeof checkClaims>>;
  try {
    result = await checkClaims(
      items,
      facts,
      { title: build.request.targetTitle, company: "", facts: null },
      null,
    );
  } catch (error) {
    if (
      error instanceof BudgetExceededError ||
      error instanceof ClaimCheckError ||
      isPermanentApiError(error)
    ) {
      await markUnchecked(
        cvId,
        error instanceof BudgetExceededError
          ? `${UNCHECKED_MESSAGE} ${error.message}`
          : UNCHECKED_MESSAGE,
      );
      return { flagged: 0 };
    }
    throw error;
  }

  const own = result.flags.map(({ itemId, kind, reason, text }) => ({
    itemId,
    kind,
    reason,
    text,
  }));
  await setCvClaimCheck(cvId, {
    flags: [...(build.claimFlags?.flags ?? []), ...own],
    checkedAt: new Date().toISOString(),
    checkError:
      result.unchecked.length > 0
        ? missedLinesMessage(result.unchecked.length)
        : null,
  });
  return { flagged: own.length };
}

/** Keeps the code check's flags and records why Claude's check didn't run. */
export async function markUnchecked(
  cvId: string,
  message: string,
): Promise<void> {
  const build = await getCvBuild(cvId);
  if (!build) return;
  await setCvClaimCheck(cvId, {
    flags: build.claimFlags?.flags ?? [],
    checkedAt: null,
    checkError: message,
  });
}

/**
 * Draws the PDF in the design asked for, leaving out bullets until it fits
 * the length asked for, and makes the CV ready. The links at the top are
 * the owner's as saved now, standard answers first. Drawing a ready CV again
 * in another design counts the bullets it left out before.
 */
export async function renderStep(cvId: string): Promise<{ pages: number }> {
  const build = await getCvBuild(cvId);
  if (!build?.content) throw new NonRetriableError("The CV was never written.");
  const [profile, inputs] = await Promise.all([
    getSnapshotProfile(build.snapshotId),
    getTailorInputs(),
  ]);
  if (!profile) throw new NonRetriableError("The profile snapshot is gone.");
  const links = ownerLinks(profile.links, inputs?.answers?.links ?? null);
  const template = build.request.template ?? LEGACY_CV_TEMPLATE;
  const fitted = await fitToPages(
    build.content,
    CV_LENGTH_PAGES[build.request.length],
    async (content) => {
      const bytes = await renderCvPdf(
        builtCvView(content, build.claimFlags, profile, build.request, links),
        template,
      );
      return { bytes, pages: pdfPageCount(bytes) };
    },
  );
  await saveCvPdf(cvId, {
    ...fitted,
    trimmed: build.trimmed + fitted.trimmed,
  });
  return { pages: fitted.pages };
}

/** Builds one CV for each `cv/build.requested` event. */
export const buildCv = inngest.createFunction(
  {
    id: "build-cv",
    name: "Build a CV",
    triggers: [cvBuildRequested],
    retries: 2,
    onFailure: async ({ event, error }) => {
      await failCvBuild(
        event.data.event.data.cvId,
        error.message.slice(0, 500),
      );
    },
  },
  async ({ event, step }) => runCvBuild(event.data, step),
);
