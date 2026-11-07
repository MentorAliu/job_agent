import { beforeEach, describe, expect, it, vi } from "vitest";

import { DOCX_MIME } from "@/lib/schemas/cv-upload";

class UnauthorizedError extends Error {}

const DOC_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const bytes = new TextEncoder().encode("PK fake docx");
const getDocumentDocx = vi.fn(
  async (): Promise<{ bytes: Uint8Array; filename: string } | null> => ({
    bytes,
    filename: "Jordan Sample - CV - Café Labs v2.docx",
  }),
);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/apply-kit", () => ({
  getDocumentDocx: () => getDocumentDocx(),
}));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/documents/${id}/docx`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/documents/[id]/docx", () => {
  beforeEach(() => getDocumentDocx.mockClear());

  it("sends the Word file as a download with its file name", async () => {
    const response = await call(DOC_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX_MIME);
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''Jordan%20Sample%20-%20CV%20-%20Caf%C3%A9%20Labs%20v2.docx",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a bad id, and answers 404 for answers and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getDocumentDocx).not.toHaveBeenCalled();
    getDocumentDocx.mockResolvedValueOnce(null);
    expect((await call(DOC_ID)).status).toBe(404);
    getDocumentDocx.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(DOC_ID)).status).toBe(401);
  });
});
