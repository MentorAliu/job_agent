import { describe, expect, it } from "vitest";

import { addRoleSchema, offLimitsSite } from "./added-role";

const POSTING = "Senior Frontend Engineer, remote within Europe. ".repeat(5);

describe("addRoleSchema", () => {
  it("takes a link alone, trimmed", () => {
    expect(
      addRoleSchema.parse({
        url: "  https://jobs.ashbyhq.com/lattice/1a2b  ",
        text: "   ",
      }),
    ).toEqual({ url: "https://jobs.ashbyhq.com/lattice/1a2b", text: "" });
  });

  it("asks for a whole web link", () => {
    for (const url of ["", "jobs.lattice.dev/1", "ftp://files.example.com/a"]) {
      const result = addRoleSchema.safeParse({ url, text: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["url"]);
    }
  });

  it("asks for the text of a posting on a site that forbids apps", () => {
    const result = addRoleSchema.safeParse({
      url: "https://de.linkedin.com/jobs/view/4012345678",
      text: "",
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["text"],
        message:
          "linkedin.com doesn't allow apps to read its pages. Paste the posting's text here.",
      }),
    ]);
    expect(
      addRoleSchema.safeParse({
        url: "https://de.linkedin.com/jobs/view/4012345678",
        text: POSTING,
      }).success,
    ).toBe(true);
  });

  it("wants the whole posting, not just its title", () => {
    const result = addRoleSchema.safeParse({
      url: "https://jobs.ashbyhq.com/lattice/1a2b",
      text: "Senior Frontend Engineer",
    });
    expect(result.error?.issues[0]?.message).toBe(
      "Paste the whole posting, not just its title.",
    );
  });
});

describe("offLimitsSite", () => {
  it("names the site whose terms forbid apps, on any of its hosts", () => {
    expect(offLimitsSite("https://www.indeed.com/viewjob?jk=1")).toBe(
      "indeed.com",
    );
    expect(offLimitsSite("https://jobs.ashbyhq.com/lattice/1")).toBeNull();
    expect(offLimitsSite("not a link")).toBeNull();
  });
});
