import { describe, expect, it, vi } from "vitest";

import {
  fetchPublic,
  isPublicAddress,
  isPublicUrl,
  publicOnlyFetch,
} from "./public-fetch";

describe("isPublicUrl", () => {
  it.each([
    "https://boards.greenhouse.io/acme/jobs/1",
    "http://jobs.example.com/role",
  ])("allows %s", (url) => {
    expect(isPublicUrl(new URL(url))).toBe(true);
  });

  it.each([
    "http://localhost/",
    "http://localhost./",
    "http://metadata.google.internal./computeMetadata/v1/",
    "http://printer.local./",
    "http://db/",
    "http://127.0.0.1/",
    "http://0x7f000001/",
    "http://[::1]/",
    "https://jobs.example.com:8443/",
    "https://user@jobs.example.com/",
    "ftp://jobs.example.com/",
  ])("refuses %s", (url) => {
    expect(isPublicUrl(new URL(url))).toBe(false);
  });
});

describe("isPublicAddress", () => {
  it.each(["93.184.215.14", "8.8.8.8", "2606:4700::6810:84e5"])(
    "allows %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "fd00:ec2::254",
    "fe80::1",
    "not an address",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("publicOnlyFetch", () => {
  const ok = () => vi.fn(async () => new Response("hi"));

  it("fetches a host whose addresses are all public", async () => {
    const send = ok();
    const guarded = publicOnlyFetch(async () => ["93.184.215.14"], send);
    const response = await guarded(new URL("https://jobs.example.com/a"));
    expect(await response.text()).toBe("hi");
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses a public name that points to a private address", async () => {
    const send = ok();
    const guarded = publicOnlyFetch(
      async () => ["93.184.215.14", "169.254.169.254"],
      send,
    );
    await expect(
      guarded(new URL("http://169.254.169.254.nip.io/latest/meta-data/")),
    ).rejects.toThrow(/public website/);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a name that doesn't resolve", async () => {
    const send = ok();
    const guarded = publicOnlyFetch(async () => [], send);
    await expect(guarded("https://nowhere.example/")).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("fetchPublic", () => {
  it("checks each redirect's host before following it", async () => {
    const resolve = vi.fn(async (host: string) =>
      host === "jobs.example.com" ? ["93.184.215.14"] : ["10.0.0.7"],
    );
    const send = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.com/admin" },
        }),
    );
    const result = await fetchPublic("https://jobs.example.com/role", "*/*", {
      fetch: publicOnlyFetch(resolve, send),
    });
    expect(result).toEqual({ ok: false });
    expect(resolve).toHaveBeenCalledWith("internal.example.com");
    expect(send).toHaveBeenCalledOnce();
  });
});
