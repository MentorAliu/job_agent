import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROLES_SEEN_COOKIE, VISIT_GAP_MS } from "@/lib/jobs/new-roles";

class UnauthorizedError extends Error {}

const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string) => {
  jar.set(name, value);
});
const getCurrentUser = vi.fn(async () => ({ id: "u1" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set,
  }),
}));
vi.mock("./session", () => ({
  getCurrentUser: () => getCurrentUser(),
  UnauthorizedError,
}));

const { markRolesSeen, readRolesSeen } = await import("./roles-seen");

const morning = new Date("2026-10-19T07:30:00Z");

describe("the owner's visits to Roles", () => {
  beforeEach(() => {
    jar.clear();
    set.mockClear();
  });

  it("has none before the first visit", async () => {
    await expect(readRolesSeen()).resolves.toBeNull();
  });

  it("records a visit in a long-lived, http-only cookie", async () => {
    await markRolesSeen(morning);
    expect(set).toHaveBeenCalledWith(
      ROLES_SEEN_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 400 * 24 * 60 * 60,
      }),
    );
    await expect(readRolesSeen()).resolves.toEqual({
      seenAt: morning,
      // A first visit counts the past day as new.
      newSince: new Date("2026-10-18T07:30:00Z"),
    });
  });

  it("starts a new visit where the last one ended", async () => {
    await markRolesSeen(morning);
    const evening = new Date(morning.getTime() + VISIT_GAP_MS + 1);
    await markRolesSeen(evening);
    await expect(readRolesSeen()).resolves.toEqual({
      seenAt: evening,
      newSince: morning,
    });
  });

  it("records nothing without a session", async () => {
    getCurrentUser.mockRejectedValueOnce(new UnauthorizedError());
    await expect(markRolesSeen(morning)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(set).not.toHaveBeenCalled();
  });
});
