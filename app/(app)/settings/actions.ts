"use server";

import { refresh } from "next/cache";

import { inngest } from "@/inngest/client";
import { scheduleMorningRuns } from "@/inngest/clock";
import { engineCheckRequested } from "@/inngest/events";
import {
  markEngineCheckNotSent,
  requestEngineCheck,
} from "@/lib/dal/engine-check";
import {
  removeClaudeKey,
  removeCodexSignIn,
  removeOpenAiApiKey,
  saveClaudeKey,
  saveCodexSignIn,
  saveOpenAiKey,
  saveSettings,
} from "@/lib/dal/settings";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import {
  claudeApiKeyInputSchema,
  codexLoginInputSchema,
  openAiKeyInputSchema,
  settingsInputSchema,
  UNKNOWN_TIME_ZONE,
} from "@/lib/schemas/settings";
import { engineCheckInputSchema } from "@/lib/schemas/setup";

const CHECK_NOT_SENT_MESSAGE =
  "Couldn't start the check. Check that the Inngest server is running, then try again.";

/**
 * Saves Settings. Every run reads them when it starts, so they apply from the
 * next run, and the morning runs are scheduled again in the time zone saved.
 */
export async function saveSettingsAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  if (!(await saveSettings(parsed.data))) {
    return {
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { timeZone: [UNKNOWN_TIME_ZONE] },
      },
    };
  }
  await scheduleMorningRuns(parsed.data.timeZone);
  refresh();
  return { ok: true };
}

/** Saves Codex's auth.json, so the agents can run on the owner's ChatGPT plan. */
export async function saveCodexLoginAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = codexLoginInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  await saveCodexSignIn(parsed.data.authJson);
  refresh();
  return { ok: true };
}

export async function removeCodexLoginAction(): Promise<ActionResult> {
  await removeCodexSignIn();
  refresh();
  return { ok: true };
}

/**
 * Saves the owner's OpenAI API key, so the agents can run on the OpenAI API,
 * unless OpenAI says the key is wrong.
 */
export async function saveOpenAiKeyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = openAiKeyInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  if (!(await saveOpenAiKey(parsed.data.apiKey))) {
    return {
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: {
          apiKey: [
            "OpenAI says this key isn't valid. Check you copied all of it, or create a new one.",
          ],
        },
      },
    };
  }
  refresh();
  return { ok: true };
}

export async function removeOpenAiKeyAction(): Promise<ActionResult> {
  await removeOpenAiApiKey();
  refresh();
  return { ok: true };
}

/**
 * Saves the owner's Claude API key, so the agents can run on the Claude API
 * without ANTHROPIC_API_KEY, unless the Claude API says the key is wrong.
 */
export async function saveClaudeApiKeyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = claudeApiKeyInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  if (!(await saveClaudeKey(parsed.data.apiKey))) {
    return {
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: {
          apiKey: [
            "The Claude API says this key isn't valid. Check you copied all of it, or create a new one.",
          ],
        },
      },
    };
  }
  refresh();
  return { ok: true };
}

export async function removeClaudeApiKeyAction(): Promise<ActionResult> {
  await removeClaudeKey();
  refresh();
  return { ok: true };
}

/**
 * Check it works: starts one tiny call on the engine in the background, or
 * follows the check already going. The page follows it until it's done.
 */
export async function checkEngineAction(
  input: unknown,
): Promise<ActionResult<{ checkId: string }>> {
  const parsed = engineCheckInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, created } = await requestEngineCheck(parsed.data.engine);
  if (created) {
    try {
      await inngest.send(engineCheckRequested.create({ checkId: id }));
    } catch (error) {
      console.error("Couldn't send the provider check event", error);
      await markEngineCheckNotSent(id, CHECK_NOT_SENT_MESSAGE);
      return formError(CHECK_NOT_SENT_MESSAGE);
    }
  }
  return { ok: true, checkId: id };
}
