import { beforeEach, describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";
const run = { id: RUN_ID, status: "running", jobs: [] };
const getRun = vi.fn(async (): Promise<typeof run | null> => run);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/runs", () => ({ getRun: () => getRun() }));

const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request(`http://localhost/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/runs/[id]", () => {
  beforeEach(() => getRun.mockClear());

  it("returns the run", async () => {
    const response = await call(RUN_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(run);
  });

  it("rejects an id that isn't a UUID before reading anything", async () => {
    const response = await call("not-a-run");
    expect(response.status).toBe(400);
    expect(getRun).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown run and 401 without a session", async () => {
    getRun.mockResolvedValueOnce(null);
    expect((await call(RUN_ID)).status).toBe(404);
    getRun.mockRejectedValueOnce(new UnauthorizedError("Not signed in."));
    expect((await call(RUN_ID)).status).toBe(401);
  });
});
