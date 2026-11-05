import { describe, expect, it, vi } from "vitest";

import type { CvList } from "@/lib/dal/cvs";

class UnauthorizedError extends Error {}

const list: CvList = {
  uploaded: null,
  hasProfile: true,
  built: [],
  tailored: [],
};
const listCvs = vi.fn(async (): Promise<CvList> => list);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/cvs", () => ({ listCvs: () => listCvs() }));

const { GET } = await import("./route");

describe("GET /api/cvs", () => {
  it("answers with the CVs page's cards, and 401 when signed out", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(list);
    listCvs.mockRejectedValueOnce(new UnauthorizedError());
    expect((await GET()).status).toBe(401);
  });
});
