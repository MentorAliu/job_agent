import { describe, expect, it } from "vitest";

import {
  cvBuildFormSchema,
  isBuildActive,
  LEAD_SKILLS_MAX,
  shownBuildStatus,
} from "./cv-builder";

const form = {
  targetTitle: "Senior Frontend Engineer",
  jobText: "",
  skills: ["React"],
  length: "one_page",
  sections: ["education"],
  note: "",
  template: "modern",
};

describe("cvBuildFormSchema", () => {
  it("accepts the builder's form and trims it", () => {
    expect(
      cvBuildFormSchema.parse({ ...form, targetTitle: " Lead ", note: " x " }),
    ).toMatchObject({ targetTitle: "Lead", note: "x" });
  });

  it.each([
    ["no job title", { targetTitle: "  " }],
    ["too many skills", { skills: Array(LEAD_SKILLS_MAX + 1).fill("React") }],
    ["an empty skill", { skills: [" "] }],
    ["an unknown length", { length: "three_pages" }],
    ["a section twice", { sections: ["education", "education"] }],
    ["a posting too long", { jobText: "x".repeat(12_001) }],
    ["a design that isn't one", { template: "fancy" }],
  ])("rejects %s", (_, patch) => {
    expect(cvBuildFormSchema.safeParse({ ...form, ...patch }).success).toBe(
      false,
    );
  });
});

describe("a build's progress", () => {
  const createdAt = "2026-10-19T14:00:00.000Z";
  const start = new Date(createdAt).getTime();

  it("is active until it's ready or fails", () => {
    expect(
      isBuildActive({ status: "writing", createdAt }, start + 60_000),
    ).toBe(true);
    expect(isBuildActive({ status: "ready", createdAt }, start)).toBe(false);
    expect(isBuildActive({ status: "failed", createdAt }, start)).toBe(false);
  });

  it("reads as failed once it has run too long to ever finish", () => {
    const late = start + 31 * 60_000;
    expect(isBuildActive({ status: "checking", createdAt }, late)).toBe(false);
    expect(shownBuildStatus({ status: "checking", createdAt }, late)).toBe(
      "failed",
    );
    expect(shownBuildStatus({ status: "ready", createdAt }, late)).toBe(
      "ready",
    );
  });

  it("times a CV drawn again in another design from when that started", () => {
    const late = start + 2 * 24 * 60 * 60_000;
    const updatedAt = new Date(late - 5_000);
    expect(
      isBuildActive({ status: "rendering", createdAt, updatedAt }, late),
    ).toBe(true);
    expect(
      shownBuildStatus({ status: "rendering", createdAt, updatedAt }, late),
    ).toBe("rendering");
  });
});
