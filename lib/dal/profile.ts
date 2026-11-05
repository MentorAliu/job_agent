import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { file, profile, profileSnapshot } from "@/db/schema";
import type { StoredFile } from "@/lib/documents/file-response";
import { DOCX_MIME, PDF_MIME } from "@/lib/schemas/cv-upload";
import {
  answersSchema,
  defaultAnswers,
  defaultPreferences,
  newFactId,
  preferencesSchema,
  questionKey,
  type Answers,
  type MasterProfile,
  type Preferences,
  type SavedAnswer,
} from "@/lib/schemas/profile";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import { getStorage } from "@/lib/storage";

import { db } from "./db";
import { getCurrentUser } from "./session";

const PROFILE_ID = 1;

export type ProfileView = {
  /** Null until the profile is first saved. */
  data: MasterProfile | null;
  preferences: Preferences;
  answers: Answers;
  cvFileId: string | null;
  updatedAt: Date | null;
};

/**
 * The preferences form before anything is saved: the defaults, with the
 * owner's time zone as the first one to work in.
 */
function startingPreferences(timeZone: string): Preferences {
  return {
    ...defaultPreferences,
    timeZones: timeZone === "UTC" ? [] : [timeZone],
  };
}

export async function getProfile(): Promise<ProfileView> {
  await getCurrentUser();
  const [[row], timeZone] = await Promise.all([
    db
      .select({
        data: profile.data,
        preferences: profile.preferences,
        answers: profile.answers,
        cvFileId: profile.cvFileId,
        updatedAt: profile.updatedAt,
      })
      .from(profile)
      .where(eq(profile.id, PROFILE_ID)),
    readOwnerTimeZone(),
  ]);

  // Rows saved before a schema change fall back to the defaults.
  const preferences = preferencesSchema.safeParse(row?.preferences);
  const answers = answersSchema.safeParse(row?.answers);
  return {
    data: row?.data ?? null,
    preferences: preferences.success
      ? preferences.data
      : startingPreferences(timeZone),
    answers: answers.success ? answers.data : defaultAnswers,
    cvFileId: row?.cvFileId ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** The name on the profile, for the sidebar. Null until a profile is saved. */
export async function getProfileName(): Promise<string | null> {
  await getCurrentUser();
  const [row] = await db
    .select({ name: sql<string | null>`${profile.data} #>> '{basics,name}'` })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  return row?.name?.trim() || null;
}

export type CvUploadView = {
  id: string;
  originalName: string | null;
  /** PDF or DOCX. Only a PDF opens in the app's viewer. */
  mime: string;
  status: "pending" | "succeeded" | "failed";
  error: string | null;
  /** The draft Claude read from the CV, once `status` is `succeeded`. */
  parsedProfile: MasterProfile | null;
  /** The owner kept the saved profile instead of this draft. */
  dismissed: boolean;
  createdAt: Date;
};

const cvUploadColumns = {
  id: file.id,
  originalName: file.originalName,
  mime: file.mime,
  status: file.parseStatus,
  error: file.parseError,
  parsedProfile: file.parsedProfile,
  draftDismissedAt: file.draftDismissedAt,
  createdAt: file.createdAt,
};

function toCvUploadView({
  draftDismissedAt,
  status,
  ...row
}: {
  id: string;
  originalName: string | null;
  mime: string;
  status: CvUploadView["status"] | null;
  error: string | null;
  parsedProfile: MasterProfile | null;
  draftDismissedAt: Date | null;
  createdAt: Date;
}): CvUploadView {
  return {
    ...row,
    status: status ?? "pending",
    dismissed: draftDismissedAt !== null,
  };
}

/** The most recently uploaded CV, or null when none was uploaded yet. */
export async function getLatestCvUpload(): Promise<CvUploadView | null> {
  await getCurrentUser();
  const [row] = await db
    .select(cvUploadColumns)
    .from(file)
    .where(eq(file.kind, "cv_upload"))
    .orderBy(desc(file.createdAt))
    .limit(1);
  return row ? toCvUploadView(row) : null;
}

export async function getCvUpload(id: string): Promise<CvUploadView | null> {
  await getCurrentUser();
  const [row] = await db
    .select(cvUploadColumns)
    .from(file)
    .where(and(eq(file.id, id), eq(file.kind, "cv_upload")));
  return row ? toCvUploadView(row) : null;
}

const CV_EXTENSIONS: Record<string, string> = {
  [PDF_MIME]: "pdf",
  [DOCX_MIME]: "docx",
};

/** An uploaded CV's file, as the owner uploaded it. */
export async function getCvFile(id: string): Promise<StoredFile | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      storageKey: file.storageKey,
      mime: file.mime,
      originalName: file.originalName,
    })
    .from(file)
    .where(and(eq(file.id, id), eq(file.kind, "cv_upload")));
  if (!row) return null;
  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) return null;
  return {
    bytes: new Uint8Array(bytes),
    mime: row.mime,
    filename: row.originalName ?? `CV.${CV_EXTENSIONS[row.mime] ?? "pdf"}`,
  };
}

/**
 * Stores an uploaded CV and records it as waiting to be read. The caller
 * sends the Inngest event that reads it.
 */
export async function createCvUpload(upload: {
  bytes: Uint8Array;
  mime: string;
  originalName: string;
}): Promise<{ id: string }> {
  await getCurrentUser();
  const extension = CV_EXTENSIONS[upload.mime];
  if (!extension) throw new Error(`Unsupported CV type: ${upload.mime}`);

  const id = randomUUID();
  const storageKey = `cv/${id}.${extension}`;
  const storage = getStorage();
  await storage.put(storageKey, upload.bytes);
  try {
    await db.insert(file).values({
      id,
      kind: "cv_upload",
      storageKey,
      mime: upload.mime,
      sizeBytes: upload.bytes.byteLength,
      sha256: createHash("sha256").update(upload.bytes).digest("hex"),
      originalName: upload.originalName.slice(0, 255),
      parseStatus: "pending",
    });
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
  return { id };
}

/**
 * Marks an upload that's still waiting as failed, for when its background
 * read couldn't be started.
 */
export async function markCvUploadFailed(
  id: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await db
    .update(file)
    .set({ parseStatus: "failed", parseError: message })
    .where(and(eq(file.id, id), eq(file.parseStatus, "pending")));
}

export class UnknownCvUploadError extends Error {
  constructor() {
    super("That CV upload doesn't exist or hasn't been read yet.");
    this.name = "UnknownCvUploadError";
  }
}

/**
 * Saves the master profile and a snapshot of it in one transaction. Pass the
 * CV upload the profile was reviewed from, or null to keep the current one.
 */
export async function saveProfileData(
  data: MasterProfile,
  cvFileId: string | null,
): Promise<{ snapshotId: string }> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    if (cvFileId) {
      const [upload] = await tx
        .select({ id: file.id })
        .from(file)
        .where(
          and(
            eq(file.id, cvFileId),
            eq(file.kind, "cv_upload"),
            eq(file.parseStatus, "succeeded"),
          ),
        );
      if (!upload) throw new UnknownCvUploadError();
    }

    const changes = cvFileId
      ? { data, cvFileId, updatedAt: new Date() }
      : { data, updatedAt: new Date() };
    await tx
      .insert(profile)
      .values({ id: PROFILE_ID, ...changes })
      .onConflictDoUpdate({ target: profile.id, set: changes });

    const [snapshot] = await tx
      .insert(profileSnapshot)
      .values({ profileData: data })
      .returning({ id: profileSnapshot.id });
    return { snapshotId: snapshot.id };
  });
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await getCurrentUser();
  const changes = { preferences, updatedAt: new Date() };
  await db
    .insert(profile)
    .values({ id: PROFILE_ID, ...changes })
    .onConflictDoUpdate({ target: profile.id, set: changes });
}

export async function saveAnswers(answers: Answers): Promise<void> {
  await getCurrentUser();
  const changes = { answers, updatedAt: new Date() };
  await db
    .insert(profile)
    .values({ id: PROFILE_ID, ...changes })
    .onConflictDoUpdate({ target: profile.id, set: changes });
}

export class SavedAnswersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedAnswersError";
  }
}

/**
 * Saves an answer given in the apply kit to the standard answers: a new
 * question, or a new answer to one already saved there. Tailoring cites
 * saved answers like any other fact.
 */
export async function saveStandardAnswer({
  question,
  answer,
}: SavedAnswer): Promise<void> {
  await getCurrentUser();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ answers: profile.answers })
      .from(profile)
      .where(eq(profile.id, PROFILE_ID))
      .for("update");
    const parsed = answersSchema.safeParse(current?.answers ?? defaultAnswers);
    if (!parsed.success) {
      throw new SavedAnswersError(
        "Your standard answers couldn't be read. Open them in your profile and save them again.",
      );
    }
    const answers = parsed.data;
    const key = questionKey(question);
    const known = answers.extra.some(
      (extra) => questionKey(extra.question) === key,
    );
    const next = answersSchema.safeParse({
      ...answers,
      extra: known
        ? answers.extra.map((extra) =>
            questionKey(extra.question) === key ? { ...extra, answer } : extra,
          )
        : [...answers.extra, { id: newFactId("qa"), question, answer }],
    });
    if (!next.success) {
      throw new SavedAnswersError(
        "Your standard answers are full. Remove one in your profile first.",
      );
    }
    const changes = { answers: next.data, updatedAt: new Date() };
    await tx
      .insert(profile)
      .values({ id: PROFILE_ID, ...changes })
      .onConflictDoUpdate({ target: profile.id, set: changes });
  });
}
