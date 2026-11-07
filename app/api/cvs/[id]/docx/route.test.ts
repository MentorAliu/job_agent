import { beforeEach, describe, expect, it, vi } from "vitest";

import { DOCX_MIME } from "@/lib/schemas/cv-upload";

class UnauthorizedError extends Error {}

const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";
const bytes = new TextEncoder().encode("PK fake docx");
const getBuiltCvDocx = vi.fn(
  async (): Promise<{ bytes: Uint8Array; filename: string } | null> => ({
    bytes,
    filename: "Jordan Sample - CV - Senior Frontend Engineer.docx",
  }),
);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/cvs", () => ({
  getBuiltCvDocx: () => getBuiltCvDocx(),
}));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/cvs/${id}/docx`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/cvs/[id]/docx", () => {
  beforeEach(() => getBuiltCvDocx.mockClear());

  it("sends the Word file as a download named after the owner and the title", async () => {
    const response = await call(CV_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX_MIME);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Jordan Sample - CV - Senior Frontend Engineer\.docx"/,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getBuiltCvDocx).not.toHaveBeenCalled();
    getBuiltCvDocx.mockResolvedValueOnce(null);
    expect((await call(CV_ID)).status).toBe(404);
    getBuiltCvDocx.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(CV_ID)).status).toBe(401);
  });
});
