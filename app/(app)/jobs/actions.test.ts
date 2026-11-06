import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusChange } from "@/lib/schemas/tracker";

class JobNotFoundError extends Error {
  constructor() {
    super("That role no longer exists.");
  }
}

const EVENT_ID = "7a1d2c3b-4e5f-4a6b-9c8d-1e2f3a4b5c6d";
const changeJobStatus = vi.fn(async (change: StatusChange) => ({
  from: "new" as const,
  to: change.status,
  eventId: EVENT_ID,
}));

class JobRemoveError extends Error {
  constructor() {
    super(
      "A role you applied to stays in Applications, so it can't be removed.",
    );
  }
}
const removeJob = vi.fn(async (jobId: string) => {
  void jobId;
  return { status: "removed" as const };
});
const restoreJob = vi.fn(async (jobId: string) => {
  void jobId;
  return { status: "ready" as const };
});

vi.mock("@/lib/dal/jobs", () => ({
  JobNotFoundError,
  JobRemoveError,
  changeJobStatus: (change: StatusChange) => changeJobStatus(change),
  removeJob: (jobId: string) => removeJob(jobId),
  restoreJob: (jobId: string) => restoreJob(jobId),
}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

class TailorRequestError extends Error {}
const REQUEST_ID = "9c2e4a6b-1d3f-4b5a-8c7d-6e5f4a3b2c1d";
const requestTailoring = vi.fn(
  async (
    request: unknown,
    options?: { firstOnly?: boolean },
  ): Promise<string | null> => {
    void request;
    void options;
    return REQUEST_ID;
  },
);
const markTailoringFailed = vi.fn(async (...args: unknown[]) => {
  void args;
});
const application = {
  appliedAt: "2026-10-18T12:00:00.000Z",
  followUpOn: "2026-10-25",
  documents: [{ kind: "cv", version: 2 }],
};
const markApplied = vi.fn(async (jobId: string) => {
  void jobId;
  return application;
});
const send = vi.fn(async (event: unknown) => {
  void event;
  return { ids: ["evt"] };
});

vi.mock("@/lib/dal/apply-kit", () => ({
  TailorRequestError,
  requestTailoring: (request: unknown, options?: { firstOnly?: boolean }) =>
    requestTailoring(request, options),
  markTailoringFailed: (...args: unknown[]) => markTailoringFailed(...args),
  markApplied: (jobId: string) => markApplied(jobId),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: (event: unknown) => send(event) },
}));

class SavedAnswersError extends Error {}
const saveStandardAnswer = vi.fn(async (input: unknown) => {
  void input;
});
vi.mock("@/lib/dal/profile", () => ({
  SavedAnswersError,
  saveStandardAnswer: (input: unknown) => saveStandardAnswer(input),
}));

class AddRoleError extends Error {}
const ADDED_ROLE_ID = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const addRole = vi.fn(async (input: unknown) => {
  void input;
  return ADDED_ROLE_ID;
});
const markAddUnsent = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("@/lib/dal/added-roles", () => ({
  AddRoleError,
  addRole: (input: unknown) => addRole(input),
  markAddUnsent: (...args: unknown[]) => markAddUnsent(...args),
}));

const {
  addRoleAction,
  changeJobStatusAction,
  markAppliedAction,
  removeJobAction,
  restoreJobAction,
  saveKitAnswerAction,
  tailorJobAction,
} = await import("./actions");

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

beforeEach(() => {
  requestTailoring.mockClear();
  markTailoringFailed.mockClear();
  send.mockClear();
});

describe("changeJobStatusAction", () => {
  beforeEach(() => {
    changeJobStatus.mockClear();
  });

  it("saves the status with the trimmed reason", async () => {
    expect(
      await changeJobStatusAction({
        jobId: JOB_ID,
        status: "skipped",
        reason: " Pay too low ",
      }),
    ).toEqual({ ok: true, status: "skipped", eventId: EVENT_ID });
    expect(changeJobStatus).toHaveBeenCalledWith({
      jobId: JOB_ID,
      status: "skipped",
      reason: "Pay too low",
    });
  });

  it("skips a role without a reason", async () => {
    expect(
      await changeJobStatusAction({
        jobId: JOB_ID,
        status: "skipped",
        reason: "",
      }),
    ).toEqual({ ok: true, status: "skipped", eventId: EVENT_ID });
    expect(changeJobStatus).toHaveBeenCalledWith({
      jobId: JOB_ID,
      status: "skipped",
      reason: "",
    });
  });

  it("says so when the role has gone", async () => {
    changeJobStatus.mockRejectedValueOnce(new JobNotFoundError());
    expect(
      await changeJobStatusAction({
        jobId: JOB_ID,
        status: "applied",
        reason: "",
      }),
    ).toEqual({
      ok: false,
      errors: { formErrors: ["That role no longer exists."], fieldErrors: {} },
    });
  });

  it("starts tailoring a role when it's shortlisted", async () => {
    expect(
      await changeJobStatusAction({
        jobId: JOB_ID,
        status: "shortlisted",
        reason: "Strong match",
      }),
    ).toEqual({ ok: true, status: "shortlisted", eventId: EVENT_ID });
    expect(requestTailoring).toHaveBeenCalledWith(
      { jobId: JOB_ID, kinds: ["cv", "cover_letter", "answers"], note: "" },
      { firstOnly: true },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "job/tailor.requested",
        data: { jobId: JOB_ID, requestId: REQUEST_ID },
      }),
    );
  });

  it("shortlists even when tailoring can't start", async () => {
    requestTailoring.mockRejectedValueOnce(
      new TailorRequestError("Save your profile first."),
    );
    expect(
      await changeJobStatusAction({
        jobId: JOB_ID,
        status: "shortlisted",
        reason: "Strong match",
      }),
    ).toEqual({ ok: true, status: "shortlisted", eventId: EVENT_ID });
    expect(send).not.toHaveBeenCalled();
  });

  it("doesn't tailor for other statuses", async () => {
    await changeJobStatusAction({
      jobId: JOB_ID,
      status: "applied",
      reason: "",
    });
    expect(requestTailoring).not.toHaveBeenCalled();
  });

  it("lets other errors through", async () => {
    changeJobStatus.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      changeJobStatusAction({ jobId: JOB_ID, status: "applied", reason: "" }),
    ).rejects.toThrow("connection lost");
  });
});

describe("removeJobAction and restoreJobAction", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("removes a role and refreshes the list", async () => {
    expect(await removeJobAction({ jobId: JOB_ID })).toEqual({
      ok: true,
      status: "removed",
    });
    expect(removeJob).toHaveBeenCalledWith(JOB_ID);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says why a role applied to can't be removed", async () => {
    removeJob.mockRejectedValueOnce(new JobRemoveError());
    expect(await removeJobAction({ jobId: JOB_ID })).toEqual({
      ok: false,
      errors: {
        formErrors: [
          "A role you applied to stays in Applications, so it can't be removed.",
        ],
        fieldErrors: {},
      },
    });
  });

  it("restores a role to where it was", async () => {
    expect(await restoreJobAction({ jobId: JOB_ID })).toEqual({
      ok: true,
      status: "ready",
    });
    expect(restoreJob).toHaveBeenCalledWith(JOB_ID);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("rejects a bad id", async () => {
    expect(await removeJobAction({ jobId: "nope" })).toMatchObject({
      ok: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("tailorJobAction", () => {
  it("records the request and sends the event", async () => {
    expect(
      await tailorJobAction({
        jobId: JOB_ID,
        kinds: ["cover_letter"],
        note: " Shorter. ",
      }),
    ).toEqual({ ok: true, requestId: REQUEST_ID });
    expect(requestTailoring).toHaveBeenCalledWith(
      { jobId: JOB_ID, kinds: ["cover_letter"], note: "Shorter." },
      undefined,
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("asks for at least one document, and starts nothing", async () => {
    const result = await tailorJobAction({
      jobId: JOB_ID,
      kinds: [],
      note: "",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { kinds: ["Pick at least one document."] },
      },
    });
    expect(requestTailoring).not.toHaveBeenCalled();
  });

  it("marks the request failed when the event can't be sent", async () => {
    send.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await tailorJobAction({
      jobId: JOB_ID,
      kinds: ["cv", "cover_letter", "answers"],
      note: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.formErrors[0]).toMatch(/Inngest server/);
    expect(markTailoringFailed).toHaveBeenCalledWith(
      JOB_ID,
      REQUEST_ID,
      expect.stringMatching(/Inngest server/),
    );
  });

  it("says why a request was refused", async () => {
    requestTailoring.mockRejectedValueOnce(
      new TailorRequestError("Claude is already tailoring this role."),
    );
    expect(
      await tailorJobAction({ jobId: JOB_ID, kinds: ["cv"], note: "" }),
    ).toEqual({
      ok: false,
      errors: {
        formErrors: ["Claude is already tailoring this role."],
        fieldErrors: {},
      },
    });
  });
});

describe("markAppliedAction", () => {
  it("returns what was recorded as sent", async () => {
    expect(await markAppliedAction({ jobId: JOB_ID })).toEqual({
      ok: true,
      application,
    });
    expect(markApplied).toHaveBeenCalledWith(JOB_ID);
  });

  it("rejects a bad id", async () => {
    expect((await markAppliedAction({ jobId: "nope" })).ok).toBe(false);
  });
});

describe("saveKitAnswerAction", () => {
  beforeEach(() => {
    saveStandardAnswer.mockClear();
  });

  it("saves the trimmed answer to the standard answers", async () => {
    expect(
      await saveKitAnswerAction({
        question: "What are your salary expectations?",
        answer: "  EUR 70K a year ",
      }),
    ).toEqual({ ok: true });
    expect(saveStandardAnswer).toHaveBeenCalledWith({
      question: "What are your salary expectations?",
      answer: "EUR 70K a year",
    });
  });

  it("asks for an answer, and saves nothing", async () => {
    expect(
      await saveKitAnswerAction({ question: "Why us?", answer: "  " }),
    ).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { answer: ["Write your answer first."] },
      },
    });
    expect(saveStandardAnswer).not.toHaveBeenCalled();
  });

  it("says when the standard answers are full", async () => {
    saveStandardAnswer.mockRejectedValueOnce(
      new SavedAnswersError("Your standard answers are full."),
    );
    expect(
      await saveKitAnswerAction({
        question: "Why us?",
        answer: "The product.",
      }),
    ).toEqual({
      ok: false,
      errors: {
        formErrors: ["Your standard answers are full."],
        fieldErrors: {},
      },
    });
  });
});

describe("addRoleAction", () => {
  const POSTING = "Senior Frontend Engineer at Lattice Works. ".repeat(6);

  beforeEach(() => {
    addRole.mockClear();
    markAddUnsent.mockClear();
    refresh.mockClear();
  });

  it("saves the link and the trimmed text, then sends the event", async () => {
    expect(
      await addRoleAction({
        url: " https://jobs.ashbyhq.com/lattice/1a2b ",
        text: ` ${POSTING} `,
      }),
    ).toEqual({ ok: true, addedRoleId: ADDED_ROLE_ID });
    expect(addRole).toHaveBeenCalledWith({
      url: "https://jobs.ashbyhq.com/lattice/1a2b",
      text: POSTING.trim(),
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "role/add.requested",
        data: { addedRoleId: ADDED_ROLE_ID },
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for the text of a LinkedIn posting, and adds nothing", async () => {
    const result = await addRoleAction({
      url: "https://www.linkedin.com/jobs/view/4012345678",
      text: "",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: {
          text: [
            "linkedin.com doesn't allow apps to read its pages. Paste the posting's text here.",
          ],
        },
      },
    });
    expect(addRole).not.toHaveBeenCalled();
  });

  it("asks for a whole web link", async () => {
    const result = await addRoleAction({ url: "lattice jobs", text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.fieldErrors.url?.[0]).toMatch(/whole link/);
  });

  it("marks it failed when the event can't be sent", async () => {
    send.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await addRoleAction({
      url: "https://jobs.ashbyhq.com/lattice/1a2b",
      text: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.formErrors[0]).toMatch(/Inngest server/);
    expect(markAddUnsent).toHaveBeenCalledWith(
      ADDED_ROLE_ID,
      expect.stringMatching(/Inngest server/),
    );
  });

  it("says why it can't add the role", async () => {
    addRole.mockRejectedValueOnce(
      new AddRoleError("That role is being added already."),
    );
    const result = await addRoleAction({
      url: "https://jobs.ashbyhq.com/lattice/1a2b",
      text: "",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: ["That role is being added already."],
        fieldErrors: {},
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
