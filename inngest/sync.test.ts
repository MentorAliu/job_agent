import { describe, expect, it, vi } from "vitest";

import { syncInngestApp } from "./sync";

const ENDPOINT = "http://127.0.0.1:3000/api/inngest";

describe("syncInngestApp", () => {
  it("retries while the app or Inngest is starting, then syncs", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("Inngest isn't up", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sleep = vi.fn(async () => {});

    expect(await syncInngestApp(ENDPOINT, { fetch: send, sleep })).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith(ENDPOINT, { method: "PUT" });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after its tries and says how to sync by hand", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response("Unauthorized", { status: 401 }),
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await syncInngestApp(ENDPOINT, {
        attempts: 3,
        fetch: send,
        sleep: async () => {},
      }),
    ).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/after 3 tries \(HTTP 401: Unauthorized\)/),
    );
    warn.mockRestore();
  });
});
