import { describe, expect, it } from "vitest";

import { returnPath } from "./return-to";

describe("returnPath", () => {
  it.each([
    ["/jobs", "/jobs"],
    ["/jobs/4c3f7a52?tab=kit", "/jobs/4c3f7a52?tab=kit"],
    ["/applications/1", "/applications/1"],
    ["/settings#agents", "/settings"],
  ])("keeps %s", (value, path) => {
    expect(returnPath(value)).toBe(path);
  });

  it.each([
    null,
    undefined,
    "",
    "/",
    "jobs",
    "//evil.example/jobs",
    "/\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/sign-in",
    "/sign-in?next=/jobs",
    "/api/profile/cv",
    "/jobs\nx",
    `/${"a".repeat(2001)}`,
  ])("refuses %s", (value) => {
    expect(returnPath(value)).toBeNull();
  });
});
