import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredFile } from "@/lib/documents/file-response";
import { DOCX_MIME } from "@/lib/schemas/cv-upload";

class UnauthorizedError extends Error {}

const UPLOAD_ID = "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11";
const bytes = new TextEncoder().encode("PK\x03\x04 fake docx");
const getCvFile = vi.fn(async (): Promise<StoredFile | null> => ({
  bytes,
  mime: DOCX_MIME,
  filename: "Jordan Sample CV (2).docx",
}));

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/profile", () => ({ getCvFile: () => getCvFile() }));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/profile/cv/${id}/file`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/profile/cv/[id]/file", () => {
  beforeEach(() => getCvFile.mockClear());

  it("sends the CV as uploaded, as a download the browser can't sniff", async () => {
    const response = await call(UPLOAD_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX_MIME);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Jordan Sample CV (2).docx"; filename*=UTF-8''Jordan%20Sample%20CV%20%282%29.docx`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getCvFile).not.toHaveBeenCalled();
    getCvFile.mockResolvedValueOnce(null);
    expect((await call(UPLOAD_ID)).status).toBe(404);
    getCvFile.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(UPLOAD_ID)).status).toBe(401);
  });
});
