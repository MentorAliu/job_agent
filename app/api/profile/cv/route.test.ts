import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const getCurrentUser = vi.fn(async () => ({ id: "u1" }));
const createCvUpload = vi.fn(async () => ({
  id: "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11",
}));
const markCvUploadFailed = vi.fn(async () => {});
const send = vi.fn(async (): Promise<{ ids: string[] }> => ({ ids: ["evt"] }));

vi.mock("@/lib/dal/session", () => ({
  getCurrentUser: () => getCurrentUser(),
  UnauthorizedError,
}));
vi.mock("@/lib/dal/profile", () => ({
  createCvUpload: (...args: unknown[]) => createCvUpload(...(args as [])),
  markCvUploadFailed: (...args: unknown[]) =>
    markCvUploadFailed(...(args as [])),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => send(...(args as [])) },
}));

const { POST } = await import("./route");

function upload(
  name: string,
  bytes: string | Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
) {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  return new Request("http://localhost/api/profile/cv", {
    method: "POST",
    body: form,
    headers,
  });
}

describe("POST /api/profile/cv", () => {
  beforeEach(() => {
    getCurrentUser.mockClear();
    createCvUpload.mockClear();
    markCvUploadFailed.mockClear();
    send.mockClear();
  });

  it("marks the upload failed when the background read can't start", async () => {
    send.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:8288"),
    );
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const response = await POST(upload("cv.pdf", "%PDF-1.7 fake"));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/Inngest server/);
    expect(markCvUploadFailed).toHaveBeenCalledWith(
      "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11",
      expect.stringContaining("Couldn't start reading the CV"),
    );
  });

  it.each(["cross-site", "same-site"])(
    "refuses an upload a %s page sends",
    async (site) => {
      const response = await POST(
        upload("cv.pdf", "%PDF-1.7 fake", { "sec-fetch-site": site }),
      );
      expect(response.status).toBe(403);
      expect(getCurrentUser).not.toHaveBeenCalled();
      expect(createCvUpload).not.toHaveBeenCalled();
    },
  );

  it("takes an upload from a client that doesn't say where it's from", async () => {
    const response = await POST(upload("cv.pdf", "%PDF-1.7 fake", {}));
    expect(response.status).toBe(202);
  });

  it("stores a PDF and starts reading it", async () => {
    const response = await POST(upload("cv.pdf", "%PDF-1.7 fake"));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11",
    });
    expect(createCvUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "application/pdf",
        originalName: "cv.pdf",
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "profile/cv.uploaded",
        data: { fileId: "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11" },
      }),
    );
  });

  it("accepts a DOCX by its ZIP signature and extension", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const response = await POST(upload("cv.docx", zip));
    expect(response.status).toBe(202);
    expect(createCvUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
  });

  it("rejects other file types", async () => {
    const response = await POST(upload("cv.pdf", "just text"));
    expect(response.status).toBe(415);
    expect(createCvUpload).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    const response = await POST(
      new Request("http://localhost/api/profile/cv", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a CV file to upload.",
    });
  });

  it("rejects a file over 4 MB", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const response = await POST(upload("cv.pdf", big));
    expect(response.status).toBe(400);
  });

  it("answers 401 when signed out", async () => {
    getCurrentUser.mockRejectedValueOnce(
      new UnauthorizedError("Not signed in."),
    );
    const response = await POST(upload("cv.pdf", "%PDF-1.7 fake"));
    expect(response.status).toBe(401);
    expect(createCvUpload).not.toHaveBeenCalled();
  });
});
