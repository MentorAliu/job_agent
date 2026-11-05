import { describe, expect, it } from "vitest";

import { stackKey, stackMatcher } from "./stack";

describe("stackKey", () => {
  it("treats spellings of the same tool as one", () => {
    expect(stackKey("Next.js")).toBe(stackKey("NextJS"));
    expect(stackKey("next js")).toBe(stackKey("Next"));
    expect(stackKey("Node.js")).toBe("node");
    expect(stackKey("React Query")).toBe(stackKey("TanStack Query"));
    expect(stackKey("JS")).toBe(stackKey("JavaScript"));
    expect(stackKey("PostgreSQL")).toBe(stackKey("Postgres"));
  });

  it("keeps the symbols that tell languages apart", () => {
    expect(stackKey("C#")).not.toBe(stackKey("C++"));
    expect(stackKey("C")).not.toBe(stackKey("C#"));
  });
});

describe("stackMatcher", () => {
  it("finds the tools the owner lists, however they're written", () => {
    const owns = stackMatcher(["TypeScript", "React", "Next.js", "NestJS"]);
    expect(
      ["typescript", "React.js", "NextJS", "Nest.js", "GraphQL"].map(owns),
    ).toEqual([true, true, true, true, false]);
  });

  it("matches nothing when the owner lists nothing", () => {
    expect(stackMatcher([])("React")).toBe(false);
  });
});
