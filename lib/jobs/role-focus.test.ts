import { describe, expect, it } from "vitest";

import type { RoleFocus } from "@/lib/schemas/job";

import { boardTitleRank, focusFromTitle, focusRank } from "./role-focus";

describe("focusFromTitle", () => {
  it("reads a frontend role in any framework", () => {
    for (const title of [
      "Senior Frontend Engineer",
      "Senior Front-End Developer (Vue)",
      "Lead UI Engineer",
      "Senior React Developer",
      "Angular Engineer",
      "Svelte Engineer",
      "Senior TypeScript Engineer",
      "Design Engineer",
    ]) {
      expect(focusFromTitle(title), title).toBe("frontend");
    }
  });

  it("tells full-stack, mobile and backend roles apart", () => {
    const cases: [string, RoleFocus][] = [
      ["Senior Full Stack Engineer (React/Node)", "fullstack"],
      ["Fullstack Developer", "fullstack"],
      ["Senior React Native Engineer", "mobile"],
      ["iOS Engineer", "mobile"],
      ["Senior Backend Engineer", "backend"],
      ["Senior Data Engineer", "backend"],
      ["Java Developer", "backend"],
      ["Senior .NET Developer", "backend"],
      ["C++ Engineer", "backend"],
      ["Senior C# Developer", "backend"],
      ["Senior Go Engineer", "backend"],
      ["Senior Software Engineer", "other"],
    ];
    for (const [title, focus] of cases) {
      expect(focusFromTitle(title), title).toBe(focus);
    }
  });

  it("ranks the wanted kind first, then the kinds near it, then the rest", () => {
    expect(focusRank("frontend", "frontend")).toBe(0);
    expect(focusRank("fullstack", "frontend")).toBe(1);
    expect(focusRank("backend", "frontend")).toBe(2);
    expect(focusRank("mobile", "frontend")).toBe(2);
    expect(focusRank("other", "frontend")).toBe(2);
    expect(focusRank(null, "frontend")).toBe(2);

    expect(focusRank("backend", "backend")).toBe(0);
    expect(focusRank("fullstack", "backend")).toBe(1);
    expect(focusRank("frontend", "backend")).toBe(2);

    expect(focusRank("fullstack", "fullstack")).toBe(0);
    expect(focusRank("frontend", "fullstack")).toBe(1);
    expect(focusRank("backend", "fullstack")).toBe(1);
    expect(focusRank("mobile", "fullstack")).toBe(2);

    expect(focusRank("mobile", "mobile")).toBe(0);
    expect(focusRank("fullstack", "mobile")).toBe(2);
  });

  it("ranks every kind the same when any will do", () => {
    for (const focus of [
      "frontend",
      "fullstack",
      "backend",
      "mobile",
      "other",
      null,
    ] as const) {
      expect(focusRank(focus, "any")).toBe(0);
    }
  });
});

const FRONTEND_SENIOR = {
  roleFocus: "frontend",
  seniority: ["senior", "lead"],
} as const;

describe("boardTitleRank", () => {
  it("reads frontend, full-stack and unnamed developer roles, in that order", () => {
    expect(boardTitleRank("Senior Frontend Engineer", FRONTEND_SENIOR)).toBe(0);
    expect(boardTitleRank("Full-Stack Engineer", FRONTEND_SENIOR)).toBe(1);
    expect(boardTitleRank("Senior Software Engineer", FRONTEND_SENIOR)).toBe(2);
  });

  it("skips backend, mobile, junior and non-developer roles for a senior frontend developer", () => {
    for (const title of [
      "Senior Backend Engineer",
      "Senior .NET Developer",
      "Android Developer",
      "Junior Frontend Developer",
      "Frontend Intern",
      "Senior Product Designer",
      "Engineering Manager, Frontend",
      "QA Engineer",
      "Account Executive",
      "Office Manager",
    ]) {
      expect(boardTitleRank(title, FRONTEND_SENIOR), title).toBeNull();
    }
  });

  it("follows the kind of role wanted", () => {
    const backend = { roleFocus: "backend", seniority: ["senior"] } as const;
    expect(boardTitleRank("Senior Backend Engineer", backend)).toBe(0);
    expect(boardTitleRank("Full-Stack Engineer", backend)).toBe(1);
    expect(boardTitleRank("Senior Software Engineer", backend)).toBe(2);
    expect(boardTitleRank("Senior Frontend Engineer", backend)).toBeNull();

    const mobile = { roleFocus: "mobile", seniority: [] } as const;
    expect(boardTitleRank("React Native Developer", mobile)).toBe(0);
    expect(boardTitleRank("Senior Frontend Engineer", mobile)).toBeNull();
  });

  it("reads every developer role when any will do, and junior ones when wanted", () => {
    const any = { roleFocus: "any", seniority: ["junior", "mid"] } as const;
    for (const title of [
      "Senior Backend Engineer",
      "Android Developer",
      "Junior Frontend Developer",
      "Senior Software Engineer",
    ]) {
      expect(boardTitleRank(title, any), title).toBe(0);
    }
    expect(boardTitleRank("Senior Product Designer", any)).toBeNull();
  });
});
