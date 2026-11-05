import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const DOC_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const bytes = new TextEncoder().encode("%PDF-1.3 fake");
const getDocumentPdf = vi.fn(
  async (): Promise<{ bytes: Uint8Array; filename: string } | null> => ({
    bytes,
    filename: "Jordan Sample - CV - Café Labs v2.pdf",
  }),
);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/apply-kit", () => ({
  getDocumentPdf: () => getDocumentPdf(),
}));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/documents/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/documents/[id]/pdf", () => {
  beforeEach(() => getDocumentPdf.mockClear());

  it("sends the PDF as a download with its file name", async () => {
    const response = await call(DOC_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Jordan Sample - CV - Cafe Labs v2.pdf"; filename*=UTF-8''Jordan%20Sample%20-%20CV%20-%20Caf%C3%A9%20Labs%20v2.pdf`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getDocumentPdf).not.toHaveBeenCalled();
    getDocumentPdf.mockResolvedValueOnce(null);
    expect((await call(DOC_ID)).status).toBe(404);
    getDocumentPdf.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(DOC_ID)).status).toBe(401);
  });
});
