import "server-only";

import { eq, sql } from "drizzle-orm";

import { builtCv, profile, profileSnapshot } from "@/db/schema";
import { defaultCvForm } from "@/lib/cvs/defaults";
import { DAILY_RUN_TIME, timeZoneName } from "@/lib/jobs/today";
import { readSettings, writeSettings } from "@/lib/pipeline/settings";
import {
  isSetupDone,
  readSetupRow,
  savableTimeZone,
  writeSetupRow,
} from "@/lib/pipeline/setup";
import type { BuiltCvStatus } from "@/lib/schemas/cv-builder";
import {
  defaultPreferences,
  preferencesSchema,
  type MasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";
import type {
  EngineCheckView,
  SetupCvPath,
  SetupStep,
  WantedAnswers,
} from "@/lib/schemas/setup";
import { UNKNOWN_TIME_ZONE, type AgentEngine } from "@/lib/schemas/settings";
import { preferencesWith, startingAnswers } from "@/lib/setup/prefill";
import {
  cvConfirmable,
  firstOpenStep,
  profileReady,
  providerPassed,
  wantedSaved,
  type StepsDone,
} from "@/lib/setup/progress";

import { createBuiltCv, getBuiltCv, NoProfileError } from "./cvs";
import { db } from "./db";
import { getLatestEngineCheck } from "./engine-check";
import { getLatestCvUpload, savePreferences } from "./profile";
import { getCurrentUser } from "./session";
import { getSettings, type EngineView } from "./settings";

const PROFILE_ID = 1;

/** The CV upload setup follows: the latest one. */
export type SetupUpload = {
  id: string;
  originalName: string | null;
  status: "pending" | "succeeded" | "failed";
  error: string | null;
  createdAt: string;
};

/** The ATS-friendly CV the agent writes from the profile. */
export type SetupAtsCv = {
  id: string;
  status: BuiltCvStatus;
  error: string | null;
  pdfUrl: string | null;
  pageCount: number | null;
  createdAt: string;
  /** The profile changed after the CV was written, so it's out of date. */
  outdated: boolean;
};

/** Everything the setup page shows, read again whenever something changes. */
export type SetupState = {
  done: boolean;
  /** Which steps are done; the account always is, or setup wouldn't open. */
  completed: StepsDone;
  /** The first step that isn't done. */
  current: SetupStep;
  provider: {
    /** The engine picked, or the default until one is. */
    engine: AgentEngine;
    /** False until an engine is picked here or in Settings. */
    chosen: boolean;
    engines: Record<AgentEngine, EngineView>;
    runner: "vercel-sandbox" | "local";
    /** The latest check of `engine`. */
    check: EngineCheckView | null;
    passed: boolean;
  };
  cv: {
    path: SetupCvPath | null;
    upload: SetupUpload | null;
    /** The profile as it is now, from the upload or the form. */
    profile: MasterProfile | null;
    confirmed: boolean;
    atsCv: SetupAtsCv | null;
  };
  wanted: {
    saved: boolean;
    /** The saved answers, else the ones the CV suggests. */
    answers: WantedAnswers;
    /** What the CV suggests, offered as extra choices beside saved answers. */
    suggested: WantedAnswers;
  };
  ready: {
    dailyRunEnabled: boolean;
    dailyRunTime: string;
    /**
     * The owner's time zone, once saved. Until then the Ready step offers
     * the browser's, and finishing setup saves it.
     */
    timeZone: string | null;
  };
};

async function readProfileRow(): Promise<{
  data: MasterProfile | null;
  preferences: Preferences | null;
}> {
  const [row] = await db
    .select({ data: profile.data, preferences: profile.preferences })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  const preferences = preferencesSchema.safeParse(row?.preferences);
  return {
    data: row?.data ?? null,
    preferences: preferences.success ? preferences.data : null,
  };
}

async function readAtsCv(id: string | null): Promise<SetupAtsCv | null> {
  if (!id) return null;
  const [cv, [written]] = await Promise.all([
    getBuiltCv(id),
    // jsonb equality ignores key order, so this is "the profile is still
    // the one the CV was written from".
    db
      .select({
        same: sql<
          boolean | null
        >`${profileSnapshot.profileData} = ${profile.data}`,
      })
      .from(builtCv)
      .innerJoin(profileSnapshot, eq(profileSnapshot.id, builtCv.snapshotId))
      .leftJoin(profile, eq(profile.id, PROFILE_ID))
      .where(eq(builtCv.id, id)),
  ]);
  if (!cv) return null;
  return {
    id: cv.id,
    status: cv.status,
    error: cv.error,
    pdfUrl: cv.pdfUrl,
    pageCount: cv.pageCount,
    createdAt: cv.createdAt,
    outdated: written?.same !== true,
  };
}

export async function getSetupState(): Promise<SetupState> {
  await getCurrentUser();
  const [settingsView, row, profileRow, upload, done] = await Promise.all([
    getSettings(),
    readSetupRow(),
    readProfileRow(),
    getLatestCvUpload(),
    isSetupDone(),
  ]);
  const { agentEngine: engine, dailyRunEnabled } = settingsView.values;
  const savedZone = timeZoneName(row?.timeZone);
  const [check, atsCv] = await Promise.all([
    getLatestEngineCheck(engine),
    readAtsCv(row?.atsCvId ?? null),
  ]);

  const passed = providerPassed({
    chosen: settingsView.saved,
    engine,
    check,
    loginSavedAt: settingsView.engines[engine].loginSavedAt,
  });
  // A CV uploaded after Looks right replaces the profile, so it has to be
  // looked at again. Edits from setup's form unconfirm it when saved.
  const confirmed =
    Boolean(row?.cvConfirmedAt) &&
    profileReady(profileRow.data) &&
    !(upload && row?.cvConfirmedAt && upload.createdAt > row.cvConfirmedAt);
  const saved = wantedSaved(profileRow.preferences);
  const completed: StepsDone = {
    provider: passed,
    cv: confirmed,
    wanted: saved,
    ready: done,
  };

  return {
    done,
    completed,
    current: firstOpenStep(completed),
    provider: {
      engine,
      chosen: settingsView.saved,
      engines: settingsView.engines,
      runner: settingsView.runner,
      check,
      passed,
    },
    cv: {
      path: row?.cvPath ?? null,
      upload: upload
        ? {
            id: upload.id,
            originalName: upload.originalName,
            status: upload.status,
            error: upload.error,
            createdAt: upload.createdAt.toISOString(),
          }
        : null,
      profile: profileRow.data,
      confirmed,
      atsCv,
    },
    wanted: {
      saved,
      answers: startingAnswers(
        profileRow.data,
        profileRow.preferences,
        savedZone,
      ),
      suggested: startingAnswers(profileRow.data, null, savedZone),
    },
    ready: {
      dailyRunEnabled,
      dailyRunTime: DAILY_RUN_TIME,
      timeZone: savedZone,
    },
  };
}

/** Whether first-run setup is finished, for the app's pages. */
export async function getSetupDone(): Promise<boolean> {
  await getCurrentUser();
  return isSetupDone();
}

/**
 * Picks what the agents run on. The first time, it saves Settings with the
 * daily search and budget they'd have used anyway, so nothing else changes.
 */
export async function chooseSetupEngine(engine: AgentEngine): Promise<void> {
  await getCurrentUser();
  const current = await readSettings();
  await writeSettings({
    dailyRunEnabled: current.dailyRunEnabled,
    monthlyBudgetUsd: current.monthlyBudgetUsd,
    agentEngine: engine,
  });
}

/** Upload or the form. Choosing again means the CV has to be looked at again. */
export async function chooseSetupCvPath(path: SetupCvPath): Promise<void> {
  await getCurrentUser();
  await writeSetupRow({ cvPath: path, cvConfirmedAt: null });
}

/** The CV changed (a new upload, or edits): it has to be looked at again. */
export async function unconfirmSetupCv(): Promise<void> {
  await getCurrentUser();
  await writeSetupRow({ cvConfirmedAt: null });
}

/**
 * Starts the agent writing an ATS-friendly CV from the profile as it is,
 * with the builder's defaults. The caller sends the Inngest event.
 */
export async function createSetupAtsCv(): Promise<{ id: string }> {
  await getCurrentUser();
  const { data, preferences } = await readProfileRow();
  if (!data) throw new NoProfileError();
  const { id } = await createBuiltCv(defaultCvForm(data, preferences));
  await writeSetupRow({ atsCvId: id });
  return { id };
}

export class SetupStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupStepError";
  }
}

/** Looks right: the CV step is done, when what it needs is there. */
export async function confirmSetupCv(withoutAtsCv: boolean): Promise<void> {
  await getCurrentUser();
  const [row, { data }, upload] = await Promise.all([
    readSetupRow(),
    readProfileRow(),
    getLatestCvUpload(),
  ]);
  const atsCv = await readAtsCv(row?.atsCvId ?? null);
  const path = row?.cvPath ?? null;
  if (
    !cvConfirmable({
      path,
      profile: data,
      uploadStatus: upload?.status ?? null,
      atsCv,
      withoutAtsCv,
    })
  ) {
    throw new SetupStepError(
      !profileReady(data)
        ? "Your profile needs your name and at least one role, school or skill."
        : path === "upload"
          ? "Wait for the agent to finish reading your CV."
          : "Wait for your CV to be written, or go on without it.",
    );
  }
  await writeSetupRow({ cvConfirmedAt: new Date() });
}

/**
 * Saves what the owner is looking for into the job preferences, keeping the
 * rest of them (salary, companies to skip) as they were.
 */
export async function saveWantedAnswers(answers: WantedAnswers): Promise<void> {
  await getCurrentUser();
  const { preferences } = await readProfileRow();
  await savePreferences(
    preferencesWith(preferences ?? defaultPreferences, answers),
  );
}

/**
 * Finishes setup: the app opens from now on, whatever changes later, and the
 * morning runs start in `timeZone`. Every step has to be done first.
 */
export async function finishSetup({
  dailyRunEnabled,
  timeZone,
}: {
  dailyRunEnabled: boolean;
  timeZone: string;
}): Promise<void> {
  const state = await getSetupState();
  const open = (["provider", "cv", "wanted"] as const).find(
    (step) => !state.completed[step],
  );
  if (open) {
    throw new SetupStepError(
      open === "provider"
        ? "Check that the agents' provider works first."
        : open === "cv"
          ? "Finish the CV step first."
          : "Answer what you're looking for first.",
    );
  }
  const savable = await savableTimeZone(timeZone);
  if (!savable) throw new SetupStepError(UNKNOWN_TIME_ZONE);
  const current = await readSettings();
  await writeSettings({
    dailyRunEnabled,
    monthlyBudgetUsd: current.monthlyBudgetUsd,
    agentEngine: current.agentEngine,
  });
  await writeSetupRow({ doneAt: new Date(), timeZone: savable });
}
