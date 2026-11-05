import { describe, expect, it, vi } from "vitest";

import type { TopBarView } from "@/lib/jobs/top-bar";

class UnauthorizedError extends Error {}

const view: TopBarView = {
  search: {
    state: "on",
    runId: null,
    stats: null,
    nextSearch: "tomorrow",
    reason: null,
    kitsToday: 2,
  },
  newRoles: 4,
  next: { kind: "reply", jobId: "j1", company: "Acme" },
  working: false,
};
const getTopBar = vi.fn(async (): Promise<TopBarView> => view);

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/top-bar", () => ({ getTopBar: () => getTopBar() }));

const { GET } = await import("./route");

describe("GET /api/top-bar", () => {
  it("answers with what the top bar shows", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(view);
  });

  it("answers 401 without a session", async () => {
    getTopBar.mockRejectedValueOnce(new UnauthorizedError("Not signed in."));
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
