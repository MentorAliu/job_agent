import { describe, expect, it, vi } from "vitest";

import type { CvContent } from "@/lib/schemas/tailor";

import { bulletCount, dropOneBullet, fitToPages } from "./fit";

const bullets = (role: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${role}:${index}`,
    text: `${role} bullet ${index + 1}`,
    sources: [role],
  }));

const content: CvContent = {
  kind: "cv",
  summary: null,
  experience: [
    { roleId: "r1", highlights: bullets("r1", 3) },
    { roleId: "r2", highlights: bullets("r2", 3) },
    { roleId: "r3", highlights: bullets("r3", 2) },
  ],
  projects: [{ projectId: "p1", highlights: bullets("p1", 1) }],
  skillIds: [],
};

const shape = (cv: CvContent) => [
  ...cv.experience.map((role) => role.highlights.length),
  ...cv.projects.map((project) => project.highlights.length),
];

describe("dropOneBullet", () => {
  it("takes from the oldest role, then projects, then the newest roles", () => {
    const steps: number[][] = [];
    let current: CvContent | null = content;
    while (current) {
      steps.push(shape(current));
      current = dropOneBullet(current);
    }
    expect(steps).toEqual([
      [3, 3, 2, 1],
      [3, 3, 1, 1],
      [3, 2, 1, 1],
      [2, 2, 1, 1],
      [2, 2, 1],
      [2, 1, 1],
      [1, 1, 1],
    ]);
  });

  it("drops a role's last bullet first", () => {
    const shorter = dropOneBullet(content);
    expect(shorter?.experience[2].highlights.map((item) => item.id)).toEqual([
      "r3:0",
    ]);
  });
});

describe("fitToPages", () => {
  const draw = (pagesFor: (cv: CvContent) => number) =>
    vi.fn(async (cv: CvContent) => ({
      bytes: new Uint8Array([bulletCount(cv)]),
      pages: pagesFor(cv),
    }));

  it("draws once when the CV already fits", async () => {
    const drawn = draw(() => 1);
    const fitted = await fitToPages(content, 1, drawn);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(fitted).toMatchObject({ pages: 1, trimmed: 0, content });
  });

  it("leaves bullets out until it fits, and counts them", async () => {
    // Two pages until three bullets are gone.
    const drawn = draw((cv) => (bulletCount(cv) > 6 ? 2 : 1));
    const fitted = await fitToPages(content, 1, drawn);
    expect(fitted.pages).toBe(1);
    expect(fitted.trimmed).toBe(3);
    expect(shape(fitted.content)).toEqual([2, 2, 1, 1]);
    expect(fitted.bytes).toEqual(new Uint8Array([6]));
  });

  it("stops when nothing more can go, even if it still runs over", async () => {
    const fitted = await fitToPages(
      content,
      1,
      draw(() => 3),
    );
    expect(fitted.pages).toBe(3);
    expect(shape(fitted.content)).toEqual([1, 1, 1]);
    expect(fitted.trimmed).toBe(bulletCount(content) - 3);
  });
});
