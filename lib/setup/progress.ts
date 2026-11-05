// Which first-run setup steps are done, from what's saved. The server decides
// it for every request, so setup picks up where it was left in any tab, and
// the browser only shows it.
import type { MasterProfile, Preferences } from "@/lib/schemas/profile";
import {
  SETUP_STEPS,
  type EngineCheckView,
  type SetupCvPath,
  type SetupStep,
} from "@/lib/schemas/setup";
import type { BuiltCvStatus } from "@/lib/schemas/cv-builder";
import type { AgentEngine } from "@/lib/schemas/settings";

/**
 * The provider step is done once the engine was picked and its latest check
 * passed after its sign-in or key was last saved, so a new key is checked
 * again.
 */
export function providerPassed({
  chosen,
  engine,
  check,
  loginSavedAt,
}: {
  chosen: boolean;
  engine: AgentEngine;
  check: EngineCheckView | null;
  loginSavedAt: string | null;
}): boolean {
  if (!chosen || !check) return false;
  if (check.engine !== engine || check.status !== "passed") return false;
  return (
    !loginSavedAt || Date.parse(check.createdAt) >= Date.parse(loginSavedAt)
  );
}

/** A profile the agents can work from: a name, and a role, school or skill. */
export function profileReady(profile: MasterProfile | null): boolean {
  if (!profile?.basics.name.trim()) return false;
  return (
    profile.experience.length +
      profile.education.length +
      profile.skills.length >
    0
  );
}

/**
 * Whether Looks right can finish the CV step. From the form, the agent
 * writes an ATS-friendly CV first: it has to be ready and written from the
 * profile as it is, or have failed and the owner chose to go on without it.
 * An upload needs only the profile, once no newer CV is still being read.
 */
export function cvConfirmable({
  path,
  profile,
  uploadStatus,
  atsCv,
  withoutAtsCv,
}: {
  path: SetupCvPath | null;
  profile: MasterProfile | null;
  /** The latest CV upload's status, if there's one. */
  uploadStatus: "pending" | "succeeded" | "failed" | null;
  atsCv: { status: BuiltCvStatus; outdated: boolean } | null;
  withoutAtsCv: boolean;
}): boolean {
  if (!path || !profileReady(profile)) return false;
  if (path === "upload") return uploadStatus !== "pending";
  if (!atsCv) return false;
  return (
    (atsCv.status === "ready" && !atsCv.outdated) ||
    (atsCv.status === "failed" && withoutAtsCv)
  );
}

/** What the search needs from the answers: where to work and what to look for. */
export function wantedSaved(preferences: Preferences | null): boolean {
  return Boolean(
    preferences &&
    preferences.countries.length > 0 &&
    preferences.timeZones.length > 0 &&
    preferences.stack.length > 0,
  );
}

export type StepsDone = Record<SetupStep, boolean>;

/** The first step that isn't done: where setup opens. */
export function firstOpenStep(done: StepsDone): SetupStep {
  return SETUP_STEPS.find((step) => !done[step]) ?? "ready";
}

/**
 * The step to show: the one asked for, when every step before it is done,
 * else the first open one. A step ahead can't be skipped to.
 */
export function shownStep(asked: SetupStep | null, done: StepsDone): SetupStep {
  const open = firstOpenStep(done);
  if (!asked) return open;
  return SETUP_STEPS.indexOf(asked) <= SETUP_STEPS.indexOf(open) ? asked : open;
}
