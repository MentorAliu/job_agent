import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuiltCvDetail } from "@/lib/dal/cvs";

class UnauthorizedError extends Error {}

const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";
const detail: BuiltCvDetail = {
  id: CV_ID,
  edited: false,
  request: {
    targetTitle: "Senior Frontend Engineer",
    jobText: "",
    skills: ["React"],
    length: "one_page",
    sections: [],
    note: "",
    template: "modern",
  },
  status: "writing",
  error: null,
  createdAt: "2026-10-19T14:00:00.000Z",
  updatedAt: "2026-10-19T14:00:00.000Z",
  readyAt: null,
  pageCount: null,
  trimmed: 0,
  pdfUrl: null,
  keywords: [],
  flags: [],
  lines: 0,
  checkedAt: null,
  checkError: null,
};
const getBuiltCv = vi.fn(async (): Promise<BuiltCvDetail | null> => detail);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/cvs", () => ({ getBuiltCv: () => getBuiltCv() }));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/cvs/${id}`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/cvs/[id]", () => {
  beforeEach(() => getBuiltCv.mockClear());

  it("answers with the CV as its page polls it", async () => {
    const response = await call(CV_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(getBuiltCv).not.toHaveBeenCalled();
    getBuiltCv.mockResolvedValueOnce(null);
    expect((await call(CV_ID)).status).toBe(404);
    getBuiltCv.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(CV_ID)).status).toBe(401);
  });
});
