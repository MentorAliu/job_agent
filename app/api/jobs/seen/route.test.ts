import { describe, expect, it, vi } from "vitest";

class UnauthorizedError extends Error {}

const markRolesSeen = vi.fn(async () => {});

vi.mock("@/lib/dal/session", () => ({ UnauthorizedError }));
vi.mock("@/lib/dal/roles-seen", () => ({
  markRolesSeen: () => markRolesSeen(),
}));

const { POST } = await import("./route");

describe("POST /api/jobs/seen", () => {
  it("records the visit and answers with no content", async () => {
    const response = await POST();
    expect(response.status).toBe(204);
    expect(markRolesSeen).toHaveBeenCalledOnce();
  });

  it("answers 401 without a session", async () => {
    markRolesSeen.mockRejectedValueOnce(
      new UnauthorizedError("Not signed in."),
    );
    const response = await POST();
    expect(response.status).toBe(401);
  });
});
