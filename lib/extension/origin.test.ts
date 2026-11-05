import { describe, expect, it } from "vitest";

import { appOrigin } from "./origin";

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("appOrigin", () => {
  it("uses the address the browser asked for, not the server's own", () => {
    expect(
      appOrigin(
        request("http://0.0.0.0:3000/api/extension/download", {
          host: "localhost:3100",
        }),
      ),
    ).toBe("http://localhost:3100");
  });

  it("prefers the proxy's forwarded host and protocol", () => {
    expect(
      appOrigin(
        request("http://0.0.0.0:3000/api/extension/download", {
          host: "internal:3000",
          "x-forwarded-host": "jobs.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://jobs.example.com");
  });

  it("falls back to the request's URL", () => {
    expect(
      appOrigin(request("https://jobs.example.com/api/extension/download")),
    ).toBe("https://jobs.example.com");
    expect(
      appOrigin(
        request("https://jobs.example.com/x", { host: "bad host name" }),
      ),
    ).toBe("https://jobs.example.com");
  });
});
