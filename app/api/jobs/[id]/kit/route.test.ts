import { describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const kit = { job: { id: JOB_ID, aiPolicy: null }, tailoring: null };
const getApplyKit = vi.fn(async (): Promise<typeof kit | null> => kit);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/apply-kit", () => ({ getApplyKit: () => getApplyKit() }));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/jobs/${id}/kit`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/jobs/[id]/kit", () => {
  it("returns the kit", async () => {
    const response = await call(JOB_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(kit);
  });

  it("rejects a bad id, and answers 404 and 401", async () => {
    expect((await call("nope")).status).toBe(400);
    getApplyKit.mockResolvedValueOnce(null);
    expect((await call(JOB_ID)).status).toBe(404);
    getApplyKit.mockRejectedValueOnce(new UnauthorizedError());
    expect((await call(JOB_ID)).status).toBe(401);
  });
});
