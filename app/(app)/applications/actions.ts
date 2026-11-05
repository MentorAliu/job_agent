"use server";

import { refresh } from "next/cache";

import { inngest } from "@/inngest/client";
import { emailPasted } from "@/inngest/events";
import {
  deleteEmail,
  EmailNotFoundError,
  fileEmail,
  markEmailUnsent,
  pasteEmail,
  retryEmail,
  setEmailHandled,
} from "@/lib/dal/emails";
import { JobNotFoundError } from "@/lib/dal/jobs";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import {
  emailHandledSchema,
  emailIdSchema,
  fileEmailSchema,
  pasteEmailSchema,
} from "@/lib/schemas/mail";

// Pasted emails, from a role's page and the Applications page. Both keep
// their emails in TanStack Query and refetch after each write. A write also
// changes what the server renders (the Applications list, whose turn it
// is), so each one calls refresh(): the page comes back with the action's
// response instead of in a second request.

class SendError extends Error {
  name = "SendError";
}

/** Runs a write and refreshes the page, or returns why it couldn't. */
async function writeThenRefresh<T extends object>(
  write: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const result = await write();
    refresh();
    return { ok: true, ...result };
  } catch (error) {
    if (
      error instanceof EmailNotFoundError ||
      error instanceof JobNotFoundError ||
      error instanceof SendError
    ) {
      return formError(error.message);
    }
    throw error;
  }
}

const SEND_FAILED_MESSAGE =
  "Couldn't start reading the email. Check that the Inngest server is running, then try again.";

/** Sends the event that reads the email, or marks it failed. */
async function sendForReading(emailId: string): Promise<void> {
  try {
    await inngest.send(emailPasted.create({ emailId }));
  } catch (error) {
    console.error("Couldn't send the email event", error);
    await markEmailUnsent(emailId, SEND_FAILED_MESSAGE);
    throw new SendError(SEND_FAILED_MESSAGE);
  }
}

/**
 * An email pasted into a role, or on the Applications page for the app to
 * place. Claude reads it in the background.
 */
export async function pasteEmailAction(
  input: unknown,
): Promise<ActionResult<{ emailId: string }>> {
  const parsed = pasteEmailSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return writeThenRefresh(async () => {
    const emailId = await pasteEmail(parsed.data);
    await sendForReading(emailId);
    return { emailId };
  });
}

/** Reads an email again after it failed. */
export async function retryEmailAction(input: unknown): Promise<ActionResult> {
  const parsed = emailIdSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return writeThenRefresh(async () => {
    await retryEmail(parsed.data.emailId);
    await sendForReading(parsed.data.emailId);
    return {};
  });
}

/** The suggested reply copied or dealt with, or not after all. */
export async function setEmailHandledAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = emailHandledSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return writeThenRefresh(async () => {
    await setEmailHandled(parsed.data.emailId, parsed.data.handled);
    return {};
  });
}

export async function deleteEmailAction(input: unknown): Promise<ActionResult> {
  const parsed = emailIdSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return writeThenRefresh(async () => {
    await deleteEmail(parsed.data.emailId);
    return {};
  });
}

/**
 * Files an email the app couldn't place under the role the owner picked,
 * and reads it again as about that role.
 */
export async function fileEmailAction(input: unknown): Promise<ActionResult> {
  const parsed = fileEmailSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  return writeThenRefresh(async () => {
    await fileEmail(parsed.data.emailId, parsed.data.jobId);
    await sendForReading(parsed.data.emailId);
    return {};
  });
}
