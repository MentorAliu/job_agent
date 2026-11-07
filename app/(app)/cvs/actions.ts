"use server";

import { z } from "zod";

import { inngest } from "@/inngest/client";
import { cvBuildRequested, tailorRequested } from "@/inngest/events";
import { sendProfileChanged } from "@/inngest/send-profile-changed";
import { CvEditError } from "@/lib/cvs/editor";
import { markTailoringFailed } from "@/lib/dal/apply-kit";
import {
  addSkillsToKitCv,
  deleteBuiltCv,
  saveCvEdit,
  type SavedEdit,
} from "@/lib/dal/cv-editor";
import {
  createBuiltCv,
  markBuiltCvFailed,
  NoProfileError,
  redrawBuiltCv,
  undoRedraw,
} from "@/lib/dal/cvs";
import {
  formError,
  toFieldErrors,
  type ActionResult,
} from "@/lib/schemas/action";
import { cvBuildFormSchema, cvRedrawSchema } from "@/lib/schemas/cv-builder";
import {
  addCvSkillsSchema,
  cvEditFormSchema,
  cvEditSourceSchema,
} from "@/lib/schemas/cv-editor";

const SEND_FAILED_MESSAGE =
  "Couldn't start building the CV. Check that the Inngest server is running, then try again.";

const DRAW_FAILED_MESSAGE =
  "Couldn't start drawing the CV. Check that the Inngest server is running, then try again.";

/**
 * Saves the CV builder's form and starts Claude writing the CV. The page
 * opens the new CV, which follows it until it's ready.
 */
export async function buildCvAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = cvBuildFormSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };

  let id: string;
  let addedSkills: string[];
  try {
    ({ id, addedSkills } = await createBuiltCv(parsed.data));
  } catch (error) {
    if (error instanceof NoProfileError) return formError(error.message);
    throw error;
  }
  // Skills the form added are in the profile now, so scores may change.
  if (addedSkills.length > 0) await sendProfileChanged("cv_builder");
  try {
    await inngest.send(cvBuildRequested.create({ cvId: id }));
  } catch (error) {
    console.error("Couldn't send the CV build event", error);
    await markBuiltCvFailed(id, SEND_FAILED_MESSAGE);
    return formError(SEND_FAILED_MESSAGE);
  }
  return { ok: true, id };
}

/**
 * Saves the editor's CV and starts drawing its PDF: as a new CV, whose page
 * then opens, or as the next version of a role's CV, whose kit then opens.
 */
export async function saveCvEditAction(
  sourceInput: unknown,
  input: unknown,
): Promise<ActionResult<{ href: string }>> {
  const source = cvEditSourceSchema.safeParse(sourceInput);
  if (!source.success) return formError("This CV can't be edited.");
  const parsed = cvEditFormSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };

  let saved: SavedEdit;
  try {
    saved = await saveCvEdit(source.data, parsed.data);
  } catch (error) {
    if (error instanceof CvEditError || error instanceof NoProfileError) {
      return formError(error.message);
    }
    throw error;
  }

  if (!(await drawEdit(saved))) return formError(DRAW_FAILED_MESSAGE);
  return {
    ok: true,
    href: saved.kind === "built" ? `/cvs/${saved.id}` : `/jobs/${saved.jobId}`,
  };
}

/**
 * Sends the event that draws a saved edit's PDF. Returns false, with the
 * edit marked failed, when it couldn't be sent.
 */
async function drawEdit(saved: SavedEdit): Promise<boolean> {
  try {
    if (saved.kind === "built") {
      await inngest.send(cvBuildRequested.create({ cvId: saved.id }));
    } else {
      await inngest.send(
        tailorRequested.create({
          jobId: saved.jobId,
          requestId: saved.requestId,
        }),
      );
    }
    return true;
  } catch (error) {
    console.error("Couldn't send the edited CV's event", error);
    if (saved.kind === "built") {
      await markBuiltCvFailed(saved.id, DRAW_FAILED_MESSAGE);
    } else {
      await markTailoringFailed(
        saved.jobId,
        saved.requestId,
        DRAW_FAILED_MESSAGE,
      );
    }
    return false;
  }
}

/**
 * Adds profile skills that the posting asks for to a role's tailored CV,
 * from the kit's ATS keywords, and starts drawing its next version. The
 * kit follows it like any other edit.
 */
export async function addCvSkillsAction(input: unknown): Promise<ActionResult> {
  const parsed = addCvSkillsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, errors: toFieldErrors(parsed.error) };

  let saved: SavedEdit;
  try {
    saved = await addSkillsToKitCv(
      parsed.data.documentId,
      parsed.data.skillIds,
    );
  } catch (error) {
    if (error instanceof CvEditError || error instanceof NoProfileError) {
      return formError(error.message);
    }
    throw error;
  }
  if (!(await drawEdit(saved))) return formError(DRAW_FAILED_MESSAGE);
  return { ok: true };
}

/** Deletes a CV from the General tab, with its PDF. */
export async function deleteCvAction(id: unknown): Promise<ActionResult> {
  const cvId = z.uuid().safeParse(id);
  if (!cvId.success || !(await deleteBuiltCv(cvId.data))) {
    return formError("This CV isn't there anymore.");
  }
  return { ok: true };
}

/**
 * Draws a ready CV again in another design, with the same words, so there's
 * no Claude call. Its page follows the drawing like a new CV's.
 */
export async function redrawCvAction(input: unknown): Promise<ActionResult> {
  const parsed = cvRedrawSchema.safeParse(input);
  if (!parsed.success) return formError("Pick one of the designs.");
  const { id, template } = parsed.data;
  const before = await redrawBuiltCv(id, template);
  if (!before) {
    return formError(
      "This CV is being drawn already, or it isn't there anymore.",
    );
  }
  try {
    await inngest.send(cvBuildRequested.create({ cvId: id }));
  } catch (error) {
    console.error("Couldn't send the redraw event", error);
    await undoRedraw(id, before);
    return formError(DRAW_FAILED_MESSAGE);
  }
  return { ok: true };
}
