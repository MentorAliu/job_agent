// First-run setup: the steps a new copy goes through before the app opens,
// what each one saves, and the provider check. The same schemas check the
// setup forms in the browser and the Server Actions.
import { z } from "zod";

import { preferencesSchema } from "./profile";
import { AGENT_ENGINES, timeZoneSchema } from "./settings";

/**
 * The steps after the account, in order. Ready is the last screen: leaving
 * it finishes setup.
 */
export const SETUP_STEPS = ["provider", "cv", "wanted", "ready"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_NAMES: Record<SetupStep, string> = {
  provider: "AI provider",
  cv: "Your CV",
  wanted: "What you want",
  ready: "Ready",
};

export function isSetupStep(value: string): value is SetupStep {
  return (SETUP_STEPS as readonly string[]).includes(value);
}

/** How the owner gives setup their CV: an upload, or the profile form. */
export const SETUP_CV_PATHS = ["upload", "form"] as const;
export type SetupCvPath = (typeof SETUP_CV_PATHS)[number];

export const setupCvPathSchema = z.enum(SETUP_CV_PATHS);

// ---------------------------------------------------------------------------
// The provider check
// ---------------------------------------------------------------------------

/**
 * A provider check: waiting for the background worker to pick it up,
 * running, or done.
 */
export const ENGINE_CHECK_STATUSES = [
  "queued",
  "running",
  "passed",
  "failed",
] as const;
export type EngineCheckStatus = (typeof ENGINE_CHECK_STATUSES)[number];

/**
 * Why a check failed, which decides what the owner is told to do:
 * - `setup`: the provider isn't connected (no sign-in or key).
 * - `login`: the sign-in or key was refused or has expired.
 * - `limit`: a usage limit, rate limit or empty credit.
 * - `busy`: the provider or the sign-in was busy; trying again helps.
 * - `sandbox`: the agent couldn't start, such as a CLI that isn't installed.
 * - `budget`: the monthly budget is used up.
 * - `worker`: the background worker never ran the check.
 * - `failed`: anything else, such as an answer that didn't fit.
 */
export const ENGINE_CHECK_FAILURES = [
  "setup",
  "login",
  "limit",
  "busy",
  "sandbox",
  "budget",
  "worker",
  "failed",
] as const;
export type EngineCheckFailure = (typeof ENGINE_CHECK_FAILURES)[number];

/** A check as the pages show it. */
export type EngineCheckView = {
  id: string;
  engine: (typeof AGENT_ENGINES)[number];
  status: EngineCheckStatus;
  failure: EngineCheckFailure | null;
  /** What went wrong, in plain words, when it failed. */
  message: string | null;
  /** The model that answered, when it passed. */
  model: string | null;
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
};

/** How long the page waits for the background worker before saying so. */
export const CHECK_PICKUP_WAIT_MS = 20_000;

/**
 * A check still queued or running after this long is treated as lost: the
 * worker stopped, or never picked it up.
 */
export const CHECK_LOST_AFTER_MS = 5 * 60_000;

export const LOST_CHECK_MESSAGE =
  "The check didn't finish. The background worker stopped or never picked it up.";

export const engineCheckInputSchema = z.object({
  engine: z.enum(AGENT_ENGINES, { error: "Pick what the agents run on." }),
});

// ---------------------------------------------------------------------------
// The other steps
// ---------------------------------------------------------------------------

export const chooseEngineInputSchema = engineCheckInputSchema;

export const chooseCvPathInputSchema = z.object({ path: setupCvPathSchema });

/**
 * Looks right on the CV step. `withoutAtsCv` goes on when the agent couldn't
 * write the ATS-friendly CV and the owner chose to carry on without it.
 */
export const confirmCvInputSchema = z.object({
  withoutAtsCv: z.boolean().default(false),
});

/**
 * What the owner is looking for, one question at a time. The rest of the job
 * preferences (salary, companies to skip) start empty and stay on the
 * Preferences page; setup keeps remote only on.
 */
export const wantedAnswersSchema = preferencesSchema
  .pick({
    roleFocus: true,
    seniority: true,
    countries: true,
    timeZones: true,
  })
  .extend({
    stack: preferencesSchema.shape.stack.min(
      1,
      "Add at least one skill or technology, so the search knows what to look for.",
    ),
  });

export type WantedAnswers = z.infer<typeof wantedAnswersSchema>;

/**
 * The last step: open the app, with the daily search on or off, in the time
 * zone the browser reports unless the owner picked another.
 */
export const finishSetupInputSchema = z.object({
  dailyRunEnabled: z.boolean(),
  searchNow: z.boolean(),
  timeZone: timeZoneSchema,
});

export type FinishSetupInput = z.infer<typeof finishSetupInputSchema>;
