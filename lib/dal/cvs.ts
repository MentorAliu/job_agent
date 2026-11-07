import "server-only";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  builtCv,
  document,
  file,
  job,
  profile,
  profileSnapshot,
} from "@/db/schema";
import {
  defaultCvForm,
  formFromRequest,
  resolveLeadSkills,
} from "@/lib/cvs/defaults";
import {
  cvText,
  keywordCoverage,
  profileText,
  type KeywordMatch,
} from "@/lib/cvs/keywords";
import { builtCvFilename, builtCvView } from "@/lib/cvs/view";
import { renderCvDocx } from "@/lib/documents/docx";
import { keepScoringBaseline } from "@/lib/pipeline/rescore";
import { readSettings } from "@/lib/pipeline/settings";
import { getTailorInputs } from "@/lib/pipeline/tailoring";
import {
  LOST_BUILD_MESSAGE,
  shownBuildStatus,
  type BuiltCvStatus,
  type CvBuildForm,
  type CvBuildRequest,
} from "@/lib/schemas/cv-builder";
import {
  LEGACY_CV_TEMPLATE,
  type CvTemplate,
} from "@/lib/schemas/cv-template";
import { PDF_MIME } from "@/lib/schemas/cv-upload";
import {
  masterProfileSchema,
  ownerLinks,
  preferencesSchema,
  type MasterProfile,
} from "@/lib/schemas/profile";
import type { ClaimFlag } from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";
import { getStorage } from "@/lib/storage";

import { db } from "./db";
import { getCurrentUser } from "./session";

// The CVs page (`/cvs`): the uploaded CV and every CV the app has made, the
// general ones (built with the CV builder or edited by the owner) and the
// ones tailored for a role, and the builder itself.

const PROFILE_ID = 1;

/** How many CVs of each kind the list shows, newest first. */
const LIST_LIMIT = 100;

export type BuiltCvRow = {
  id: string;
  targetTitle: string;
  /** The design it's drawn in. */
  template: CvTemplate;
  /** Built to match a pasted job posting. */
  matched: boolean;
  /** The owner made it in the editor rather than Claude. */
  edited: boolean;
  status: BuiltCvStatus;
  pageCount: number | null;
  pdfUrl: string | null;
  createdAt: string;
  /** Moves with each step, and when it's drawn again in another design. */
  updatedAt: string;
};

export type TailoredCvRow = {
  /** The document's id. */
  id: string;
  jobId: string;
  /** The role's status, so the row opens its kit or its application. */
  status: JobStatus;
  title: string;
  company: string;
  version: number;
  /** The owner made this version in the editor. */
  edited: boolean;
  pdfUrl: string | null;
  readyAt: string;
};

/** The CV the owner uploaded, which the profile was read from. */
export type UploadedCv = {
  /** The upload's file id. */
  id: string;
  name: string;
  /** Only a PDF has a preview and opens in the app's viewer. */
  isPdf: boolean;
  url: string;
  uploadedAt: string;
};

export type CvList = {
  uploaded: UploadedCv | null;
  /** The profile is saved, so a CV can be edited or built from it. */
  hasProfile: boolean;
  built: BuiltCvRow[];
  tailored: TailoredCvRow[];
};

/**
 * The built CV's PDF, with the time it was drawn: drawing it again in
 * another design keeps the CV's id and its file, so this is what tells the
 * viewer, which caches each PDF by its address, to load the new one.
 */
const builtPdfUrl = (id: string, drawnAt: Date | null) =>
  `/api/cvs/${id}/pdf${drawnAt ? `?v=${drawnAt.getTime()}` : ""}`;

export async function listCvs(): Promise<CvList> {
  await getCurrentUser();
  const [[current], built, tailored] = await Promise.all([
    db
      .select({
        hasData: sql<boolean>`${profile.data} is not null`,
        fileId: file.id,
        name: file.originalName,
        mime: file.mime,
        uploadedAt: file.createdAt,
      })
      .from(profile)
      .leftJoin(file, eq(file.id, profile.cvFileId))
      .where(eq(profile.id, PROFILE_ID)),
    db
      .select({
        id: builtCv.id,
        request: builtCv.request,
        edited: builtCv.edited,
        status: builtCv.status,
        pageCount: builtCv.pageCount,
        pdfFileId: builtCv.pdfFileId,
        createdAt: builtCv.createdAt,
        updatedAt: builtCv.updatedAt,
        readyAt: builtCv.readyAt,
      })
      .from(builtCv)
      .orderBy(desc(builtCv.createdAt))
      .limit(LIST_LIMIT),
    db
      .select({
        id: document.id,
        jobId: document.jobId,
        version: document.version,
        edited: document.edited,
        pdfFileId: document.pdfFileId,
        readyAt: document.readyAt,
        title: job.title,
        company: job.company,
        status: job.status,
      })
      .from(document)
      .innerJoin(job, eq(job.id, document.jobId))
      .where(and(eq(document.kind, "cv"), isNotNull(document.readyAt)))
      .orderBy(desc(document.readyAt))
      .limit(LIST_LIMIT),
  ]);
  return {
    uploaded:
      current?.fileId && current.uploadedAt
        ? {
            id: current.fileId,
            name: current.name ?? "Your CV",
            isPdf: current.mime === PDF_MIME,
            url: `/api/profile/cv/${current.fileId}/file`,
            uploadedAt: current.uploadedAt.toISOString(),
          }
        : null,
    hasProfile: current?.hasData ?? false,
    built: built.map((row) => {
      const status = shownBuildStatus(row);
      return {
        id: row.id,
        targetTitle: row.request.targetTitle,
        template: row.request.template ?? LEGACY_CV_TEMPLATE,
        matched: row.request.jobText !== "",
        edited: row.edited,
        status,
        pageCount: row.pageCount,
        pdfUrl:
          status === "ready" && row.pdfFileId
            ? builtPdfUrl(row.id, row.readyAt)
            : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
    tailored: tailored.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      status: row.status,
      title: row.title,
      company: row.company,
      version: row.version,
      edited: row.edited,
      pdfUrl: row.pdfFileId ? `/api/documents/${row.id}/pdf` : null,
      readyAt: (row.readyAt ?? new Date()).toISOString(),
    })),
  };
}

export type BuiltCvDetail = {
  id: string;
  /** What was asked for, with the skills by name. */
  request: CvBuildForm;
  /** The owner made it in the editor rather than Claude. */
  edited: boolean;
  status: BuiltCvStatus;
  error: string | null;
  createdAt: string;
  /** Moves with each step, and when it's drawn again in another design. */
  updatedAt: string;
  readyAt: string | null;
  pageCount: number | null;
  /** Bullets left out so it fits the length asked for. */
  trimmed: number;
  pdfUrl: string | null;
  /** The posting's keywords and where each shows up. Empty without a posting. */
  keywords: KeywordMatch[];
  /** Lines left out because their claims didn't hold up. */
  flags: ClaimFlag[];
  /** How many lines of the CV make a claim. */
  lines: number;
  checkedAt: string | null;
  checkError: string | null;
};

/** One built CV, polled by its page while Claude writes it. */
export async function getBuiltCv(id: string): Promise<BuiltCvDetail | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      id: builtCv.id,
      request: builtCv.request,
      edited: builtCv.edited,
      status: builtCv.status,
      error: builtCv.error,
      content: builtCv.content,
      keywords: builtCv.keywords,
      claimFlags: builtCv.claimFlags,
      pdfFileId: builtCv.pdfFileId,
      pageCount: builtCv.pageCount,
      trimmed: builtCv.trimmed,
      readyAt: builtCv.readyAt,
      createdAt: builtCv.createdAt,
      updatedAt: builtCv.updatedAt,
      profile: profileSnapshot.profileData,
      current: profile.data,
    })
    .from(builtCv)
    .innerJoin(profileSnapshot, eq(profileSnapshot.id, builtCv.snapshotId))
    .leftJoin(profile, eq(profile.id, PROFILE_ID))
    .where(eq(builtCv.id, id));
  if (!row) return null;

  const status = shownBuildStatus(row);
  const view = row.content
    ? builtCvView(row.content, row.claimFlags, row.profile, row.request)
    : null;
  // The CV as it was written, against the profile as it is now, so a skill
  // added since shows as one a new CV can take.
  const keywords =
    view && row.keywords && row.keywords.length > 0
      ? keywordCoverage(
          row.keywords,
          cvText(view),
          profileText(row.current ?? row.profile),
        )
      : [];
  return {
    id: row.id,
    request: formFromRequest(row.request, row.profile),
    edited: row.edited,
    status,
    error: status === "failed" ? (row.error ?? LOST_BUILD_MESSAGE) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    pageCount: row.pageCount,
    trimmed: row.trimmed,
    pdfUrl:
      status === "ready" && row.pdfFileId
        ? builtPdfUrl(row.id, row.readyAt)
        : null,
    keywords,
    flags: row.claimFlags?.flags ?? [],
    lines: row.content
      ? (row.content.summary ? 1 : 0) +
        row.content.experience.reduce(
          (sum, role) => sum + role.highlights.length,
          0,
        ) +
        row.content.projects.reduce(
          (sum, project) => sum + project.highlights.length,
          0,
        )
      : 0,
    checkedAt: row.claimFlags?.checkedAt ?? null,
    checkError: row.claimFlags?.checkError ?? null,
  };
}

/** A built CV's PDF, named after the owner and the target job title. */
export async function getBuiltCvPdf(
  id: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string } | null> {
  await getCurrentUser();
  const [row] = await db
    .select({
      storageKey: file.storageKey,
      request: builtCv.request,
      profile: profileSnapshot.profileData,
    })
    .from(builtCv)
    .innerJoin(file, eq(file.id, builtCv.pdfFileId))
    .innerJoin(profileSnapshot, eq(profileSnapshot.id, builtCv.snapshotId))
    .where(and(eq(builtCv.id, id), eq(builtCv.status, "ready")));
  if (!row) return null;
  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) return null;
  return {
    bytes: new Uint8Array(bytes),
    filename: builtCvFilename(row.profile.basics.name, row.request.targetTitle),
  };
}

/**
 * A built CV as a Word file, made from the same content as its PDF, in its
 * design, with the owner's links as saved now (as its PDF was drawn).
 */
export async function getBuiltCvDocx(
  id: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string } | null> {
  await getCurrentUser();
  const [[row], inputs] = await Promise.all([
    db
      .select({
        request: builtCv.request,
        content: builtCv.content,
        claimFlags: builtCv.claimFlags,
        profile: profileSnapshot.profileData,
      })
      .from(builtCv)
      .innerJoin(profileSnapshot, eq(profileSnapshot.id, builtCv.snapshotId))
      .where(and(eq(builtCv.id, id), eq(builtCv.status, "ready"))),
    getTailorInputs(),
  ]);
  if (!row?.content) return null;
  const links = ownerLinks(row.profile.links, inputs?.answers?.links ?? null);
  return {
    bytes: await renderCvDocx(
      builtCvView(row.content, row.claimFlags, row.profile, row.request, links),
      row.request.template ?? LEGACY_CV_TEMPLATE,
    ),
    filename: builtCvFilename(
      row.profile.basics.name,
      row.request.targetTitle,
      "docx",
    ),
  };
}

/**
 * Draws a ready CV again in another design: its words stay as they are, so
 * there's no Claude call. Returns the design it had, to put back if the
 * drawing can't be started, or null when the CV isn't ready (or is in that
 * design already). The caller sends the Inngest event.
 */
export async function redrawBuiltCv(
  id: string,
  template: CvTemplate,
): Promise<CvTemplate | null> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ request: builtCv.request })
      .from(builtCv)
      .where(and(eq(builtCv.id, id), eq(builtCv.status, "ready")))
      .for("update");
    if (!row) return null;
    const before = row.request.template ?? LEGACY_CV_TEMPLATE;
    if (before === template) return null;
    await tx
      .update(builtCv)
      .set({
        request: { ...row.request, template },
        status: "rendering",
        error: null,
      })
      .where(eq(builtCv.id, id));
    return before;
  });
}

/** Puts a CV back as it was when its redrawing couldn't be started. */
export async function undoRedraw(
  id: string,
  template: CvTemplate,
): Promise<void> {
  await getCurrentUser();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ request: builtCv.request })
      .from(builtCv)
      .where(and(eq(builtCv.id, id), eq(builtCv.status, "rendering")))
      .for("update");
    if (!row) return;
    await tx
      .update(builtCv)
      .set({ request: { ...row.request, template }, status: "ready" })
      .where(eq(builtCv.id, id));
  });
}

export type CvBuilderStart = {
  form: CvBuildForm;
  /** What the CV's header shows, from the profile. */
  name: string;
  contact: string[];
  /** Every skill in the profile, to pick from. */
  skills: string[];
};

/**
 * The builder's form, filled in from the saved profile, or from an earlier
 * CV to build again from. Null until the profile is saved.
 */
export async function getCvBuilderStart(
  fromId?: string,
): Promise<CvBuilderStart | null> {
  await getCurrentUser();
  const [current] = await db
    .select({ data: profile.data, preferences: profile.preferences })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  const data = current?.data;
  if (!data) return null;

  let form: CvBuildForm | null = null;
  if (fromId) {
    const [earlier] = await db
      .select({ request: builtCv.request })
      .from(builtCv)
      .where(eq(builtCv.id, fromId));
    if (earlier) form = formFromRequest(earlier.request, data);
  }
  const preferences = preferencesSchema.safeParse(current.preferences);
  const { basics, links } = data;
  const { cvTemplate } = await readSettings();
  return {
    form:
      form ??
      defaultCvForm(
        data,
        preferences.success ? preferences.data : null,
        cvTemplate,
      ),
    name: basics.name,
    contact: [
      basics.email,
      basics.phone,
      basics.location,
      ...links.map((link) => link.url.replace(/^https?:\/\/(www\.)?/, "")),
    ].filter(Boolean),
    skills: data.skills.map((skill) => skill.name),
  };
}

export class NoProfileError extends Error {
  constructor() {
    super(
      "Upload your CV on the Profile page first: a new CV is built from it.",
    );
    this.name = "NoProfileError";
  }
}

/**
 * Saves a CV to be built from the current profile. Skills the form names
 * that the profile doesn't have are added to the profile first, with a new
 * snapshot, so the CV can cite them. The caller sends the Inngest event.
 */
export async function createBuiltCv(
  form: CvBuildForm,
): Promise<{ id: string; addedSkills: string[] }> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ data: profile.data })
      .from(profile)
      .where(eq(profile.id, PROFILE_ID))
      .for("update");
    if (!current?.data) throw new NoProfileError();

    const { skillIds, added } = resolveLeadSkills(current.data, form.skills);
    let snapshotId: string | undefined;
    if (added.length > 0) {
      await keepScoringBaseline(tx);
      const data: MasterProfile = masterProfileSchema.parse({
        ...current.data,
        skills: [...current.data.skills, ...added],
      });
      await tx
        .update(profile)
        .set({ data, updatedAt: new Date() })
        .where(eq(profile.id, PROFILE_ID));
      const [snapshot] = await tx
        .insert(profileSnapshot)
        .values({ profileData: data })
        .returning({ id: profileSnapshot.id });
      snapshotId = snapshot.id;
    } else {
      const [latest] = await tx
        .select({ id: profileSnapshot.id })
        .from(profileSnapshot)
        .orderBy(desc(profileSnapshot.createdAt))
        .limit(1);
      snapshotId = latest?.id;
    }
    if (!snapshotId) throw new NoProfileError();

    const request: CvBuildRequest = {
      targetTitle: form.targetTitle,
      jobText: form.jobText,
      skillIds,
      length: form.length,
      sections: form.sections,
      note: form.note,
      template: form.template,
    };
    const [created] = await tx
      .insert(builtCv)
      .values({ request, snapshotId })
      .returning({ id: builtCv.id });
    return { id: created.id, addedSkills: added.map((skill) => skill.name) };
  });
}

/** Marks a build that couldn't be started as failed. */
export async function markBuiltCvFailed(
  id: string,
  message: string,
): Promise<void> {
  await getCurrentUser();
  await db
    .update(builtCv)
    .set({ status: "failed", error: message })
    .where(
      and(
        eq(builtCv.id, id),
        inArray(builtCv.status, ["writing", "checking", "rendering"]),
      ),
    );
}
