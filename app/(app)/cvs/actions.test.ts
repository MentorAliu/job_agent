import { beforeEach, describe, expect, it, vi } from "vitest";

import { CvEditError } from "@/lib/cvs/editor";
import type { SavedEdit } from "@/lib/dal/cv-editor";
import type { CvBuildForm } from "@/lib/schemas/cv-builder";
import type { CvEditForm, CvEditSource } from "@/lib/schemas/cv-editor";

const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";
const JOB_ID = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const REQUEST_ID = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b";

class NoProfileError extends Error {}

const createBuiltCv = vi.fn(async () => ({ id: CV_ID, addedSkills: [] }));
const markBuiltCvFailed = vi.fn(async () => {});
const saveCvEdit = vi.fn(async (): Promise<SavedEdit> => ({
  kind: "built",
  id: CV_ID,
}));
const deleteBuiltCv = vi.fn(async () => true);
const addSkillsToKitCv = vi.fn(async (): Promise<SavedEdit> => ({
  kind: "kit",
  jobId: JOB_ID,
  requestId: REQUEST_ID,
}));
const markTailoringFailed = vi.fn(async () => {});
const send = vi.fn(async (): Promise<{ ids: string[] }> => ({ ids: ["evt"] }));

vi.mock("@/lib/dal/cvs", () => ({
  createBuiltCv: (...args: unknown[]) => createBuiltCv(...(args as [])),
  markBuiltCvFailed: (...args: unknown[]) => markBuiltCvFailed(...(args as [])),
  NoProfileError,
}));
vi.mock("@/lib/dal/cv-editor", () => ({
  saveCvEdit: (...args: unknown[]) => saveCvEdit(...(args as [])),
  deleteBuiltCv: (...args: unknown[]) => deleteBuiltCv(...(args as [])),
  addSkillsToKitCv: (...args: unknown[]) => addSkillsToKitCv(...(args as [])),
}));
vi.mock("@/lib/dal/apply-kit", () => ({
  markTailoringFailed: (...args: unknown[]) =>
    markTailoringFailed(...(args as [])),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => send(...(args as [])) },
}));

const { addCvSkillsAction, buildCvAction, deleteCvAction, saveCvEditAction } =
  await import("./actions");

const form: CvBuildForm = {
  targetTitle: "  Senior Frontend Engineer ",
  jobText: "",
  skills: ["React", " TypeScript "],
  length: "one_page",
  sections: ["projects", "education"],
  note: "",
};

describe("buildCvAction", () => {
  beforeEach(() => {
    createBuiltCv.mockClear();
    markBuiltCvFailed.mockClear();
    send.mockClear();
  });

  it("saves the trimmed form and starts the build", async () => {
    expect(await buildCvAction(form)).toEqual({ ok: true, id: CV_ID });
    expect(createBuiltCv).toHaveBeenCalledWith({
      ...form,
      targetTitle: "Senior Frontend Engineer",
      skills: ["React", "TypeScript"],
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cv/build.requested",
        data: { cvId: CV_ID },
      }),
    );
  });

  it("returns field errors and saves nothing when the form is invalid", async () => {
    const result = await buildCvAction({
      ...form,
      targetTitle: " ",
      sections: ["projects", "projects"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors.fieldErrors).sort()).toEqual([
      "sections",
      "targetTitle",
    ]);
    expect(createBuiltCv).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("says to upload a CV first when there's no profile", async () => {
    createBuiltCv.mockRejectedValueOnce(
      new NoProfileError("Upload your CV on the Profile page first."),
    );
    expect(await buildCvAction(form)).toEqual({
      ok: false,
      errors: {
        formErrors: ["Upload your CV on the Profile page first."],
        fieldErrors: {},
      },
    });
  });

  it("marks the CV failed when the build can't start", async () => {
    send.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:8288"),
    );
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const result = await buildCvAction(form);
    expect(result.ok).toBe(false);
    expect(markBuiltCvFailed).toHaveBeenCalledWith(
      CV_ID,
      expect.stringMatching(/Inngest server/),
    );
  });
});

const edit: CvEditForm = {
  title: " Frontend Lead ",
  summary: "",
  skillIds: ["skill_a1b2c3d4"],
  experience: [
    {
      roleId: "role_a1b2c3d4",
      shown: true,
      lines: [{ ref: "cv:role_a1b2c3d4:0" }, { ref: "fact:hl_a1b2c3d4" }],
    },
  ],
  projects: [],
  sections: ["education"],
  length: "one_page",
};
const kit: CvEditSource = { kind: "kit", id: CV_ID };

describe("saveCvEditAction", () => {
  beforeEach(() => {
    saveCvEdit.mockClear();
    markBuiltCvFailed.mockClear();
    markTailoringFailed.mockClear();
    send.mockClear();
  });

  it("saves a new CV and starts drawing it, then opens its page", async () => {
    expect(await saveCvEditAction({ kind: "profile" }, edit)).toEqual({
      ok: true,
      href: `/cvs/${CV_ID}`,
    });
    expect(saveCvEdit).toHaveBeenCalledWith(
      { kind: "profile" },
      { ...edit, title: "Frontend Lead" },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cv/build.requested",
        data: { cvId: CV_ID },
      }),
    );
  });

  it("saves a kit's next version and opens the role", async () => {
    saveCvEdit.mockResolvedValueOnce({
      kind: "kit",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
    });
    expect(await saveCvEditAction(kit, edit)).toEqual({
      ok: true,
      href: `/jobs/${JOB_ID}`,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "job/tailor.requested",
        data: { jobId: JOB_ID, requestId: REQUEST_ID },
      }),
    );
  });

  it("refuses a bad source, a typed line or an empty title", async () => {
    expect(
      await saveCvEditAction({ kind: "kit", id: "nope" }, edit),
    ).toMatchObject({ ok: false });
    const result = await saveCvEditAction(kit, {
      ...edit,
      title: " ",
      experience: [
        { ...edit.experience[0], lines: [{ ref: "Led a team of 40" }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors.fieldErrors).sort()).toEqual([
      "experience.0.lines.0.ref",
      "title",
    ]);
    expect(saveCvEdit).not.toHaveBeenCalled();
  });

  it("says so when the profile changed under the editor", async () => {
    saveCvEdit.mockRejectedValueOnce(
      new CvEditError("Reload the page and try again."),
    );
    const result = await saveCvEditAction(kit, edit);
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: ["Reload the page and try again."],
        fieldErrors: {},
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("marks the kit failed when drawing can't start", async () => {
    saveCvEdit.mockResolvedValueOnce({
      kind: "kit",
      jobId: JOB_ID,
      requestId: REQUEST_ID,
    });
    send.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await saveCvEditAction(kit, edit)).ok).toBe(false);
    expect(markTailoringFailed).toHaveBeenCalledWith(
      JOB_ID,
      REQUEST_ID,
      expect.stringMatching(/Inngest server/),
    );
    expect(markBuiltCvFailed).not.toHaveBeenCalled();
  });
});

describe("addCvSkillsAction", () => {
  const input = {
    documentId: CV_ID,
    skillIds: ["skill_00000030", "skill_00000099"],
  };

  beforeEach(() => {
    addSkillsToKitCv.mockClear();
    markTailoringFailed.mockClear();
    send.mockClear();
  });

  it("adds the skills as the kit's next CV and starts drawing it", async () => {
    expect(await addCvSkillsAction(input)).toEqual({ ok: true });
    expect(addSkillsToKitCv).toHaveBeenCalledWith(CV_ID, input.skillIds);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "job/tailor.requested",
        data: { jobId: JOB_ID, requestId: REQUEST_ID },
      }),
    );
  });

  it("refuses a bad CV id or no skills", async () => {
    expect((await addCvSkillsAction({ ...input, documentId: "nope" })).ok).toBe(
      false,
    );
    expect((await addCvSkillsAction({ ...input, skillIds: [] })).ok).toBe(
      false,
    );
    expect(addSkillsToKitCv).not.toHaveBeenCalled();
  });

  it("says why when the CV can't take them", async () => {
    addSkillsToKitCv.mockRejectedValueOnce(
      new CvEditError("Those skills are on this CV already."),
    );
    expect(await addCvSkillsAction(input)).toEqual({
      ok: false,
      errors: {
        formErrors: ["Those skills are on this CV already."],
        fieldErrors: {},
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("marks the kit failed when drawing can't start", async () => {
    send.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await addCvSkillsAction(input)).ok).toBe(false);
    expect(markTailoringFailed).toHaveBeenCalledWith(
      JOB_ID,
      REQUEST_ID,
      expect.stringMatching(/Inngest server/),
    );
  });
});

describe("deleteCvAction", () => {
  it("deletes the CV, and says when it's already gone", async () => {
    expect(await deleteCvAction(CV_ID)).toEqual({ ok: true });
    expect(deleteBuiltCv).toHaveBeenCalledWith(CV_ID);
    deleteBuiltCv.mockResolvedValueOnce(false);
    expect((await deleteCvAction(CV_ID)).ok).toBe(false);
    expect((await deleteCvAction("nope")).ok).toBe(false);
    expect(deleteBuiltCv).toHaveBeenCalledTimes(2);
  });
});
