"use server";

import { refresh } from "next/cache";

import { inngest } from "@/inngest/client";
import { roleAddRequested, tailorRequested } from "@/inngest/events";
import { AddRoleError, addRole, markAddUnsent } from "@/lib/dal/added-roles";
import {
  markApplied,
  markTailoringFailed,
  requestTailoring,
  TailorRequestError,
  type ApplyKit,
} from "@/lib/dal/apply-kit";
import {
  changeJobStatus,
  JobNotFoundError,
  JobRemoveError,
  removeJob,
  restoreJob,
} from "@/lib/dal/jobs";
import { SavedAnswersError, saveStandardAnswer } from "@/lib/dal/profile";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import { addRoleSchema } from "@/lib/schemas/added-role";
import { savedAnswerSchema } from "@/lib/schemas/profile";
import {
  DOCUMENT_KINDS,
  markAppliedSchema,
  tailorRequestSchema,
} from "@/lib/schemas/tailor";
import {
  jobRefSchema,
  statusChangeSchema,
  type JobStatus,
} from "@/lib/schemas/tracker";

// The role page updates its TanStack Query caches itself (optimistically,
// then by invalidating), so these actions don't refresh(), except Remove and
// Restore, which the Roles page's server-rendered list offers too.

async function orNotFound<T extends object>(
  write: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await write()) };
  } catch (error) {
    if (
      error instanceof JobNotFoundError ||
      error instanceof JobRemoveError ||
      error instanceof TailorRequestError
    ) {
      return formError(error.message);
    }
    throw error;
  }
}

const SEND_FAILED_MESSAGE =
  "Couldn't start tailoring. Check that the Inngest server is running, then try again.";

/** Sends the event that runs a tailoring request, or marks it failed. */
async function sendTailoring(jobId: string, requestId: string): Promise<void> {
  try {
    await inngest.send(tailorRequested.create({ jobId, requestId }));
  } catch (error) {
    console.error("Couldn't send the tailoring event", error);
    await markTailoringFailed(jobId, requestId, SEND_FAILED_MESSAGE);
    throw new TailorRequestError(SEND_FAILED_MESSAGE);
  }
}

/**
 * Any status, from the role page's status menu or Prepare kit. Picking a
 * role that has no documents yet starts tailoring it.
 */
export async function changeJobStatusAction(
  input: unknown,
): Promise<ActionResult<{ status: JobStatus; eventId: string | null }>> {
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return orNotFound(async () => {
    const { to, eventId } = await changeJobStatus(parsed.data);
    if (to === "shortlisted") {
      try {
        const requestId = await requestTailoring(
          { jobId: parsed.data.jobId, kinds: [...DOCUMENT_KINDS], note: "" },
          { firstOnly: true },
        );
        if (requestId) await sendTailoring(parsed.data.jobId, requestId);
      } catch (error) {
        // The role is shortlisted either way; the apply kit shows why
        // tailoring didn't start and offers to try again.
        if (!(error instanceof TailorRequestError)) throw error;
      }
    }
    return { status: to, eventId };
  });
}

/** Takes a role off the lists, into the Removed tab. */
export async function removeJobAction(
  input: unknown,
): Promise<ActionResult<{ status: JobStatus }>> {
  const parsed = jobRefSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  const result = await orNotFound(() => removeJob(parsed.data.jobId));
  refresh();
  return result;
}

/** Puts a removed role back where it was. */
export async function restoreJobAction(
  input: unknown,
): Promise<ActionResult<{ status: JobStatus }>> {
  const parsed = jobRefSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  const result = await orNotFound(() => restoreJob(parsed.data.jobId));
  refresh();
  return result;
}

/** Tailor all three documents, or regenerate some of them with a note. */
export async function tailorJobAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = tailorRequestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return orNotFound(async () => {
    const requestId = await requestTailoring(parsed.data);
    await sendTailoring(parsed.data.jobId, requestId);
    return { requestId };
  });
}

/**
 * Mark as applied: records the date and the exact documents sent, and sets
 * the follow-up.
 */
export async function markAppliedAction(
  input: unknown,
): Promise<
  ActionResult<{ application: NonNullable<ApplyKit["application"]> }>
> {
  const parsed = markAppliedSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return orNotFound(async () => ({
    application: await markApplied(parsed.data.jobId),
  }));
}

/**
 * An answer the owner gives in the apply kit, for a question Claude left to
 * them. It goes into the standard answers, where this kit and later
 * tailoring find it.
 */
export async function saveKitAnswerAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = savedAnswerSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  try {
    await saveStandardAnswer(parsed.data);
  } catch (error) {
    if (error instanceof SavedAnswersError) return formError(error.message);
    throw error;
  }
  return { ok: true };
}

const ADD_SEND_FAILED_MESSAGE =
  "Couldn't start reading the role. Check that the Inngest server is running, then try again.";

/**
 * Add a role, from the Roles page: a posting's link, and its text when the
 * app can't read the page. Claude reads, checks and scores it in the
 * background, and makes its kit when the owner can take it.
 */
export async function addRoleAction(
  input: unknown,
): Promise<ActionResult<{ addedRoleId: string }>> {
  const parsed = addRoleSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  let addedRoleId: string;
  try {
    addedRoleId = await addRole(parsed.data);
  } catch (error) {
    if (error instanceof AddRoleError) return formError(error.message);
    throw error;
  }
  try {
    await inngest.send(roleAddRequested.create({ addedRoleId }));
  } catch (error) {
    console.error("Couldn't send the add-role event", error);
    await markAddUnsent(addedRoleId, ADD_SEND_FAILED_MESSAGE);
    refresh();
    return formError(ADD_SEND_FAILED_MESSAGE);
  }
  refresh();
  return { ok: true, addedRoleId };
}
