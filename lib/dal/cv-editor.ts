import "server-only";

import { and, desc, eq, isNotNull, max, sql } from "drizzle-orm";

import {
  builtCv,
  document,
  file,
  job,
  profile,
  profileSnapshot,
} from "@/db/schema";
import {
  CvEditError,
  editedContent,
  editorStart,
  type EditFrom,
  type EditorCatalogue,
} from "@/lib/cvs/editor";
import type { CvBuildRequest } from "@/lib/schemas/cv-builder";
import {
  EDIT_SKILLS_MAX,
  type CvEditForm,
  type CvEditSource,
} from "@/lib/schemas/cv-editor";
import type { MasterProfile } from "@/lib/schemas/profile";
import {
  isTailoringActive,
  newTailorState,
  TAILORABLE_STATUSES,
  type TailorState,
} from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";
import { getStorage } from "@/lib/storage";
import { flaggedIds } from "@/lib/tailor/citations";

import { NoProfileError } from "./cvs";
import { db } from "./db";
import { getCurrentUser } from "./session";

// The CV editor (`/cvs/edit`): a new CV made from an earlier one, or from
// the whole profile, by keeping and adding lines. Nothing here calls Claude.

const PROFILE_ID = 1;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What saving does: a new CV on the General tab, or a role's next CV. */
export type SaveAs =
  | { kind: "new" }
  | {
      kind: "version";
      version: number;
      jobId: string;
      title: string;
      company: string;
    };

export type CvEditorData = {
  /** The CV it starts from, in words, such as "CV for Lead at Acme". */
  from: string;
  form: CvEditForm;
  catalogue: EditorCatalogue;
  /** The CV's header, from the profile. */
  name: string;
  contact: string[];
  /** The profile's own summary, to go back to. */
  profileSummary: string;
  saveAs: SaveAs;
};

type Source = {
  from: EditFrom | null;
  label: string;
  /** A built CV's posting and its keywords, which an edit keeps. */
  posting: { jobText: string; keywords: string[] };
  /** A tailored CV's role. */
  role: {
    id: string;
    title: string;
    company: string;
    status: JobStatus;
  } | null;
};

const NO_POSTING = { jobText: "", keywords: [] };

/** The CV an edit starts from, or null when it isn't there or isn't ready. */
async function loadSource(
  tx: Tx | typeof db,
  source: CvEditSource,
  current: MasterProfile,
): Promise<Source | null> {
  switch (source.kind) {
    case "profile":
      return {
        from: null,
        label: "Your profile",
        posting: NO_POSTING,
        role: null,
      };
    case "built": {
      const [row] = await tx
        .select({
          request: builtCv.request,
          content: builtCv.content,
          claimFlags: builtCv.claimFlags,
          keywords: builtCv.keywords,
        })
        .from(builtCv)
        .where(and(eq(builtCv.id, source.id), eq(builtCv.status, "ready")));
      if (!row?.content) return null;
      const { request } = row;
      return {
        from: {
          content: row.content,
          check: row.claimFlags,
          title: request.targetTitle,
          sections: request.sections,
          length: request.length,
        },
        label: request.targetTitle,
        posting: { jobText: request.jobText, keywords: row.keywords ?? [] },
        role: null,
      };
    }
    case "kit": {
      const [row] = await tx
        .select({
          content: document.content,
          claimFlags: document.claimFlags,
          jobId: job.id,
          title: job.title,
          company: job.company,
          status: job.status,
        })
        .from(document)
        .innerJoin(job, eq(job.id, document.jobId))
        .where(
          and(
            eq(document.id, source.id),
            eq(document.kind, "cv"),
            isNotNull(document.readyAt),
          ),
        );
      if (!row || row.content.kind !== "cv") return null;
      return {
        from: {
          content: row.content,
          check: row.claimFlags,
          title: row.content.headline ?? current.basics.headline,
          sections: row.content.sections ?? null,
          length: null,
        },
        label: `CV for ${row.title} at ${row.company}`,
        posting: NO_POSTING,
        role: {
          id: row.jobId,
          title: row.title,
          company: row.company,
          status: row.status,
        },
      };
    }
  }
}

/** A tailored CV is saved into its role's kit while the kit can still be sent. */
const intoKit = (role: Source["role"]): role is NonNullable<Source["role"]> =>
  role !== null &&
  (TAILORABLE_STATUSES as readonly JobStatus[]).includes(role.status);

/**
 * The editor, opened on a CV or on the whole profile. `"no_profile"` until
 * the profile is saved; null when the CV isn't there or isn't ready.
 */
export async function getCvEditorStart(
  source: CvEditSource,
): Promise<CvEditorData | "no_profile" | null> {
  await getCurrentUser();
  const [current] = await db
    .select({ data: profile.data })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  const data = current?.data;
  if (!data) return "no_profile";

  const loaded = await loadSource(db, source, data);
  if (!loaded) return null;
  const { form, catalogue } = editorStart(data, loaded.from);

  let saveAs: SaveAs = { kind: "new" };
  if (intoKit(loaded.role)) {
    const [latest] = await db
      .select({ version: max(document.version) })
      .from(document)
      .where(and(eq(document.jobId, loaded.role.id), eq(document.kind, "cv")));
    saveAs = {
      kind: "version",
      version: (latest?.version ?? 0) + 1,
      jobId: loaded.role.id,
      title: loaded.role.title,
      company: loaded.role.company,
    };
  }

  const { basics, links } = data;
  return {
    from: loaded.label,
    form,
    catalogue,
    name: basics.name,
    contact: [
      basics.email,
      basics.phone,
      basics.location,
      ...links.map((link) => link.url.replace(/^https?:\/\/(www\.)?/, "")),
    ].filter(Boolean),
    profileSummary: basics.summary,
    saveAs,
  };
}

export type SavedEdit =
  | { kind: "built"; id: string }
  | { kind: "kit"; jobId: string; requestId: string };

/**
 * Saves the edited CV, ready for its PDF to be drawn: as a new CV on the
 * General tab, or as the next version of a role's CV, which its kit then
 * shows. The caller sends the Inngest event that draws it.
 */
export async function saveCvEdit(
  source: CvEditSource,
  form: CvEditForm,
): Promise<SavedEdit> {
  await getCurrentUser();
  return db.transaction(async (tx) => {
    // The newest snapshot is the profile as it is now.
    const [snapshot] = await tx
      .select({ id: profileSnapshot.id, data: profileSnapshot.profileData })
      .from(profileSnapshot)
      .orderBy(desc(profileSnapshot.createdAt))
      .limit(1);
    if (!snapshot) throw new NoProfileError();

    const loaded = await loadSource(tx, source, snapshot.data);
    if (!loaded) throw new CvEditError("This CV isn't there anymore.");
    const { content, flags } = editedContent(form, snapshot.data, loaded.from);
    const claimFlags = { flags, checkedAt: null, checkError: null };

    if (intoKit(loaded.role)) {
      const jobId = loaded.role.id;
      const [role] = await tx
        .select({ tailoring: job.tailoring })
        .from(job)
        .where(eq(job.id, jobId))
        .for("update");
      if (isTailoringActive(role?.tailoring ?? null)) {
        throw new CvEditError(
          "Claude is writing this role's kit right now. Save again once it's done.",
        );
      }
      // Versions are numbered one at a time per role, as tailoring does.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobId}))`);
      const [latest] = await tx
        .select({ version: max(document.version) })
        .from(document)
        .where(and(eq(document.jobId, jobId), eq(document.kind, "cv")));
      const state: TailorState = {
        ...newTailorState(["cv"], null),
        edit: true,
      };
      await tx.insert(document).values({
        jobId,
        kind: "cv",
        version: (latest?.version ?? 0) + 1,
        snapshotId: snapshot.id,
        content,
        claimFlags,
        requestId: state.requestId,
        edited: true,
      });
      await tx.update(job).set({ tailoring: state }).where(eq(job.id, jobId));
      return { kind: "kit", jobId, requestId: state.requestId };
    }

    const request: CvBuildRequest = {
      targetTitle: form.title,
      jobText: loaded.posting.jobText,
      skillIds: content.skillIds,
      length: form.length,
      sections: content.sections ?? [],
      note: "",
    };
    const [created] = await tx
      .insert(builtCv)
      .values({
        request,
        snapshotId: snapshot.id,
        edited: true,
        // Written and checked already: only the PDF is left to draw.
        status: "rendering",
        content,
        keywords: loaded.posting.keywords,
        claimFlags,
      })
      .returning({ id: builtCv.id });
    return { kind: "built", id: created.id };
  });
}

/** How many lines a CV shows under its roles and projects. */
function lineCount(form: CvEditForm): number {
  return [...form.experience, ...form.projects]
    .filter((entry) => entry.shown)
    .reduce((sum, entry) => sum + entry.lines.length, 0);
}

/**
 * Adds profile skills to a role's tailored CV, as the kit's next version,
 * keeping everything else on it. It saves what the editor would with only
 * those skills ticked, so there's no Claude call: only the PDF is drawn.
 * The caller sends the Inngest event that draws it.
 */
export async function addSkillsToKitCv(
  documentId: string,
  skillIds: string[],
): Promise<SavedEdit> {
  await getCurrentUser();
  const source = { kind: "kit", id: documentId } as const;
  const [current] = await db
    .select({ data: profile.data })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID));
  if (!current?.data) throw new NoProfileError();

  const loaded = await loadSource(db, source, current.data);
  if (!loaded?.from) throw new CvEditError("This CV isn't there anymore.");
  if (!intoKit(loaded.role)) {
    throw new CvEditError(
      "This CV went out with the application, so it stays as sent. Use Edit to make a new CV from it.",
    );
  }

  const { form, catalogue } = editorStart(current.data, loaded.from);
  // A line whose facts left the profile would drop off without the owner
  // seeing it, so that's the editor's to show.
  const { content, check, sections } = loaded.from;
  const flagged = flaggedIds(check);
  const projects = !sections || sections.includes("projects");
  const written = [...content.experience, ...(projects ? content.projects : [])]
    .flatMap((entry) => entry.highlights)
    .filter((item) => !flagged.has(item.id)).length;
  if (lineCount(form) < written) {
    throw new CvEditError(
      "Part of this CV isn't in your profile anymore. Use Edit to choose what it shows.",
    );
  }

  const known = new Set(catalogue.skills.map((skill) => skill.id));
  const added = [...new Set(skillIds)].filter(
    (id) => known.has(id) && !form.skillIds.includes(id),
  );
  if (added.length === 0) {
    throw new CvEditError("Those skills are on this CV already.");
  }
  if (form.skillIds.length + added.length > EDIT_SKILLS_MAX) {
    throw new CvEditError(
      `A CV lists at most ${EDIT_SKILLS_MAX} skills. Use Edit to choose which.`,
    );
  }

  return saveCvEdit(source, {
    ...form,
    skillIds: [...form.skillIds, ...added],
  });
}

/**
 * Deletes a CV from the General tab, with its PDF. Tailored CVs stay with
 * their roles. Returns false when there was no such CV.
 */
export async function deleteBuiltCv(id: string): Promise<boolean> {
  await getCurrentUser();
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(builtCv)
      .where(eq(builtCv.id, id))
      .returning({ pdfFileId: builtCv.pdfFileId });
    if (!row) return null;
    if (!row.pdfFileId) return { storageKey: null };
    const [stored] = await tx
      .delete(file)
      .where(eq(file.id, row.pdfFileId))
      .returning({ storageKey: file.storageKey });
    return { storageKey: stored?.storageKey ?? null };
  });
  if (!removed) return false;
  // The row is gone either way; a file left behind is only unused bytes.
  if (removed.storageKey) {
    await getStorage()
      .delete(removed.storageKey)
      .catch((error: unknown) => {
        console.warn("Couldn't delete a CV's PDF from storage", error);
      });
  }
  return true;
}
