import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("./auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

const { getCurrentUser, getOptionalUser, requireUser, UnauthorizedError } =
  await import("./session");

const session = {
  session: { id: "s1", token: "secret-token", userId: "u1" },
  user: {
    id: "u1",
    email: "owner@example.com",
    name: "Owner",
    emailVerified: false,
    image: null,
  },
};

describe("data access layer session check", () => {
  beforeEach(() => getSession.mockReset());

  it("throws UnauthorizedError when there is no session", async () => {
    getSession.mockResolvedValue(null);
    await expect(getCurrentUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns only the owner's id, email and name", async () => {
    getSession.mockResolvedValue(session);
    await expect(getCurrentUser()).resolves.toEqual({
      id: "u1",
      email: "owner@example.com",
      name: "Owner",
    });
  });

  it("returns null from getOptionalUser when signed out", async () => {
    getSession.mockResolvedValue(null);
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("redirects to /sign-in from requireUser when signed out", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /sign-in");
  });
});
