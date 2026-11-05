import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

const BASE_URL = "http://localhost:3000";

function request(path: string, cookie?: string) {
  return new NextRequest(`${BASE_URL}${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy", () => {
  it("redirects / to /sign-in when signed out", () => {
    expect(getRedirectUrl(proxy(request("/")))).toBe(`${BASE_URL}/sign-in`);
  });

  it.each([
    ["/jobs", "%2Fjobs"],
    ["/inbox", "%2Finbox"],
    ["/jobs/4c3f7a52?tab=kit", "%2Fjobs%2F4c3f7a52%3Ftab%3Dkit"],
  ])("redirects %s to /sign-in, which brings the owner back", (path, next) => {
    expect(getRedirectUrl(proxy(request(path)))).toBe(
      `${BASE_URL}/sign-in?next=${next}`,
    );
  });

  it("lets a request with a session cookie through", () => {
    const response = proxy(request("/jobs", "better-auth.session_token=abc"));
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("serves /sign-in when signed out", () => {
    expect(getRedirectUrl(proxy(request("/sign-in")))).toBeNull();
  });

  it("runs on pages but not on API routes or static files", () => {
    const matches = (url: string) =>
      unstable_doesMiddlewareMatch({ config, url });
    expect(matches("/")).toBe(true);
    expect(matches("/jobs/123")).toBe(true);
    expect(matches("/api/auth/sign-in/email")).toBe(false);
    expect(matches("/api/inngest")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/robots.txt")).toBe(false);
  });
});
