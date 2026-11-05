import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";
const bytes = new TextEncoder().encode("%PDF-1.3 fake");
const getBuiltCvPdf = vi.fn(
  async (): Promise<{ bytes: Uint8Array; filename: string } | null> => ({
    bytes,
    filename: "Jordan Sample - CV - Senior Frontend Engineer.pdf",
  }),
);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/cvs", () => ({
  getBuiltCvPdf: () => getBuiltCvPdf(),
}));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/cvs/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/cvs/[id]/pdf", () => {
  beforeEach(() => getBuiltCvPdf.mockClear());

  it("sends the PDF as a download named after the owner and the title", async () => {
    const response = await call(CV_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Jordan Sample - CV - Senior Frontend Engineer\.pdf"/,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getBuiltCvPdf).not.toHaveBeenCalled();
    getBuiltCvPdf.mockResolvedValueOnce(null);
    expect((await call(CV_ID)).status).toBe(404);
    getBuiltCvPdf.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(CV_ID)).status).toBe(401);
  });
});
