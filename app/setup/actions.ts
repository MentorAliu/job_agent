"use server";

import { inngest } from "@/inngest/client";
import { scheduleMorningRuns } from "@/inngest/clock";
import { cvBuildRequested, searchRunRequested } from "@/inngest/events";
import { markBuiltCvFailed, NoProfileError } from "@/lib/dal/cvs";
import { saveProfileData } from "@/lib/dal/profile";
import { markRunFailed, startManualRun } from "@/lib/dal/runs";
import {
  chooseSetupCvPath,
  chooseSetupEngine,
  confirmSetupCv,
  createSetupAtsCv,
  finishSetup,
  saveWantedAnswers,
  SetupStepError,
  unconfirmSetupCv,
} from "@/lib/dal/setup";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import { masterProfileSchema } from "@/lib/schemas/profile";
import {
  chooseCvPathInputSchema,
  chooseEngineInputSchema,
  confirmCvInputSchema,
  finishSetupInputSchema,
  setupCvPathSchema,
  wantedAnswersSchema,
} from "@/lib/schemas/setup";

// First-run setup's Server Actions. Each saves one step's progress; the
// page reads setup's state again afterwards (lib/setup/queries.ts).

const BUILD_NOT_SENT_MESSAGE =
  "Couldn't start writing your CV. Check that the Inngest server is running, then try again.";

/** Picks what the agents run on. The page then checks it, once it's signed in. */
export async function chooseEngineAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = chooseEngineInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await chooseSetupEngine(parsed.data.engine);
  return { ok: true };
}

/** Upload a CV, or fill in the form. */
export async function chooseCvPathAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = chooseCvPathInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await chooseSetupCvPath(parsed.data.path);
  return { ok: true };
}

/** Starts the agent writing an ATS-friendly CV from the profile. */
async function startAtsCv(): Promise<ActionResult<{ cvId: string }>> {
  let id: string;
  try {
    ({ id } = await createSetupAtsCv());
  } catch (error) {
    if (error instanceof NoProfileError) return formError(error.message);
    throw error;
  }
  try {
    await inngest.send(cvBuildRequested.create({ cvId: id }));
  } catch (error) {
    console.error("Couldn't send the CV build event", error);
    await markBuiltCvFailed(id, BUILD_NOT_SENT_MESSAGE);
    return formError(BUILD_NOT_SENT_MESSAGE);
  }
  return { ok: true, cvId: id };
}

/**
 * Saves the profile from setup's form. From the form path, it then starts
 * the ATS-friendly CV; after an upload, it only saves the fixes.
 */
export async function saveSetupProfileAction(
  pathInput: unknown,
  input: unknown,
): Promise<ActionResult> {
  const path = setupCvPathSchema.safeParse(pathInput);
  if (!path.success) return formError("Pick how to give setup your CV.");
  const parsed = masterProfileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };

  await saveProfileData(parsed.data, null);
  await unconfirmSetupCv();
  if (path.data === "upload") return { ok: true };
  const started = await startAtsCv();
  return started.ok ? { ok: true } : started;
}

/** Write an ATS-friendly CV: once after an upload, or again after a failure. */
export async function buildAtsCvAction(): Promise<ActionResult> {
  const started = await startAtsCv();
  return started.ok ? { ok: true } : started;
}

/** Looks right: the CV step is done. */
export async function confirmCvAction(input: unknown): Promise<ActionResult> {
  const parsed = confirmCvInputSchema.safeParse(input ?? {});
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  try {
    await confirmSetupCv(parsed.data.withoutAtsCv);
  } catch (error) {
    if (error instanceof SetupStepError) return formError(error.message);
    throw error;
  }
  return { ok: true };
}

/** Saves what the owner is looking for into the job preferences. */
export async function saveWantedAction(input: unknown): Promise<ActionResult> {
  const parsed = wantedAnswersSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await saveWantedAnswers(parsed.data);
  return { ok: true };
}

export type FinishSetupResult = ActionResult<{
  /** The first search: started, or why it couldn't start. */
  search: "started" | "off" | { blocked: string };
}>;

/**
 * Finishes setup, so the app opens from now on, schedules the morning runs
 * in the time zone it saved, and starts the first search when asked. A
 * search that can't start doesn't stop setup finishing: Runs says why.
 */
export async function finishSetupAction(
  input: unknown,
): Promise<FinishSetupResult> {
  const parsed = finishSetupInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  try {
    await finishSetup(parsed.data);
  } catch (error) {
    if (error instanceof SetupStepError) return formError(error.message);
    throw error;
  }
  await scheduleMorningRuns(parsed.data.timeZone);
  if (!parsed.data.searchNow) return { ok: true, search: "off" };

  const run = await startManualRun();
  if (run.kind === "blocked") {
    return { ok: true, search: { blocked: run.reason } };
  }
  if (run.kind === "created") {
    try {
      await inngest.send(searchRunRequested.create({ runId: run.runId }));
    } catch (error) {
      console.error("Couldn't send the search event", error);
      const message =
        "Couldn't start the search. Check that the Inngest server is running, then press Search now.";
      await markRunFailed(run.runId, message);
      return { ok: true, search: { blocked: message } };
    }
  }
  return { ok: true, search: "started" };
}
