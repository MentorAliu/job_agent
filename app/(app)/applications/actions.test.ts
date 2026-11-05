import { beforeEach, describe, expect, it, vi } from "vitest";

class EmailNotFoundError extends Error {
  constructor() {
    super("That email is no longer here.");
  }
}
class JobNotFoundError extends Error {
  constructor() {
    super("That role no longer exists.");
  }
}

const EMAIL_ID = "7c2d4e6f-1a3b-4c5d-8e9f-a0b1c2d3e4f5";
const JOB_ID = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const TEXT = "Hi Jordan, thanks for applying. Could we talk on Thursday?";

const pasteEmail = vi.fn(async (input: unknown) => {
  void input;
  return EMAIL_ID;
});
const retryEmail = vi.fn(async (id: string) => {
  void id;
});
const markEmailUnsent = vi.fn(async (...args: unknown[]) => {
  void args;
});
const fileEmail = vi.fn(async (...args: unknown[]) => {
  void args;
});
const send = vi.fn(async (event: unknown) => {
  void event;
  return { ids: ["evt"] };
});

vi.mock("@/lib/dal/emails", () => ({
  EmailNotFoundError,
  pasteEmail: (input: unknown) => pasteEmail(input),
  retryEmail: (id: string) => retryEmail(id),
  markEmailUnsent: (...args: unknown[]) => markEmailUnsent(...args),
  fileEmail: (...args: unknown[]) => fileEmail(...args),
  setEmailHandled: async () => {},
  deleteEmail: async () => {},
}));
const refresh = vi.fn();

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/dal/jobs", () => ({ JobNotFoundError }));
vi.mock("@/inngest/client", () => ({
  inngest: { send: (event: unknown) => send(event) },
}));

const { pasteEmailAction, retryEmailAction, fileEmailAction } =
  await import("./actions");

describe("pasteEmailAction", () => {
  beforeEach(() => {
    pasteEmail.mockClear();
    markEmailUnsent.mockClear();
    send.mockClear();
    refresh.mockClear();
  });

  it("saves the email, sends it to be read and refreshes the page", async () => {
    expect(
      await pasteEmailAction({ jobId: JOB_ID, text: `  ${TEXT}\n` }),
    ).toEqual({ ok: true, emailId: EMAIL_ID });
    expect(pasteEmail).toHaveBeenCalledWith({ jobId: JOB_ID, text: TEXT });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "email/pasted",
        data: { emailId: EMAIL_ID },
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("takes an email with no role, for the app to place", async () => {
    expect(await pasteEmailAction({ jobId: null, text: TEXT })).toMatchObject({
      ok: true,
    });
    expect(pasteEmail).toHaveBeenCalledWith({ jobId: null, text: TEXT });
  });

  it("asks for the whole email when only a line is pasted", async () => {
    expect(await pasteEmailAction({ jobId: null, text: "Thanks!" })).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: {
          text: ["Paste the whole email, not just a line of it."],
        },
      },
    });
    expect(pasteEmail).not.toHaveBeenCalled();
  });

  it("marks the email failed when it can't be sent to be read", async () => {
    send.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const result = await pasteEmailAction({ jobId: JOB_ID, text: TEXT });
    expect(result).toMatchObject({ ok: false });
    expect(markEmailUnsent).toHaveBeenCalledWith(
      EMAIL_ID,
      expect.stringContaining("Couldn't start reading the email"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when the role is gone", async () => {
    pasteEmail.mockRejectedValueOnce(new JobNotFoundError());
    expect(await pasteEmailAction({ jobId: JOB_ID, text: TEXT })).toEqual({
      ok: false,
      errors: { formErrors: ["That role no longer exists."], fieldErrors: {} },
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("retryEmailAction and fileEmailAction", () => {
  it("reads a failed email again", async () => {
    send.mockClear();
    expect(await retryEmailAction({ emailId: EMAIL_ID })).toEqual({
      ok: true,
    });
    expect(retryEmail).toHaveBeenCalledWith(EMAIL_ID);
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses an email that's gone", async () => {
    retryEmail.mockRejectedValueOnce(new EmailNotFoundError());
    expect(await retryEmailAction({ emailId: EMAIL_ID })).toMatchObject({
      ok: false,
      errors: { formErrors: ["That email is no longer here."] },
    });
  });

  it("files an email under the picked role and reads it again", async () => {
    send.mockClear();
    expect(await fileEmailAction({ emailId: EMAIL_ID, jobId: JOB_ID })).toEqual(
      { ok: true },
    );
    expect(fileEmail).toHaveBeenCalledWith(EMAIL_ID, JOB_ID);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailId: EMAIL_ID } }),
    );
    expect(await fileEmailAction({ emailId: EMAIL_ID })).toMatchObject({
      ok: false,
    });
  });
});
