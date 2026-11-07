"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { sendProfileChanged } from "@/inngest/send-profile-changed";
import {
  saveAnswers,
  savePreferences,
  saveProfileData,
  UnknownCvUploadError,
} from "@/lib/dal/profile";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import {
  answersSchema,
  masterProfileSchema,
  preferencesSchema,
} from "@/lib/schemas/profile";

const cvFileIdSchema = z.uuid().nullable();

/**
 * Saves the edited master profile and a snapshot of it. `cvFileId` is the CV
 * upload the form was filled from, or null when only edits were made.
 */
export async function saveProfileAction(
  cvFileId: string | null,
  input: unknown,
): Promise<ActionResult> {
  const parsed = masterProfileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  const upload = cvFileIdSchema.safeParse(cvFileId);
  if (!upload.success) return formError("The CV upload id is invalid.");

  try {
    await saveProfileData(parsed.data, upload.data);
  } catch (error) {
    if (error instanceof UnknownCvUploadError) return formError(error.message);
    throw error;
  }
  await sendProfileChanged("profile");
  refresh();
  return { ok: true };
}

export async function savePreferencesAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await savePreferences(parsed.data);
  await sendProfileChanged("preferences");
  refresh();
  return { ok: true };
}

export async function saveAnswersAction(input: unknown): Promise<ActionResult> {
  const parsed = answersSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await saveAnswers(parsed.data);
  refresh();
  return { ok: true };
}
