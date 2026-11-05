import { describe, expect, it } from "vitest";

import { setupCodeFor as scriptSetupCodeFor } from "../../scripts/setup.mjs";

import {
  normalizeSetupCode,
  setupCodeFor,
  setupCodeMatches,
} from "./setup-code";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("setupCodeFor", () => {
  it("gives 8 easy-to-read characters in two groups", () => {
    expect(setupCodeFor(SECRET)).toMatch(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
  });

  it("is the same every time for a secret, and differs between secrets", () => {
    expect(setupCodeFor(SECRET)).toBe(setupCodeFor(SECRET));
    expect(setupCodeFor(SECRET)).not.toBe(setupCodeFor(`${SECRET}x`));
  });

  it("matches the code scripts/setup.mjs prints", () => {
    for (const secret of [SECRET, "another-secret", "x".repeat(64)]) {
      expect(scriptSetupCodeFor(secret)).toBe(setupCodeFor(secret));
    }
  });
});

describe("setupCodeMatches", () => {
  const code = setupCodeFor(SECRET);

  it("accepts the code typed loosely", () => {
    expect(setupCodeMatches(code, SECRET)).toBe(true);
    expect(
      setupCodeMatches(` ${code.toLowerCase().replace("-", "")} `, SECRET),
    ).toBe(true);
  });

  it("refuses anything else, and everything without a secret", () => {
    expect(setupCodeMatches("ABCD-EFGH", SECRET)).toBe(false);
    expect(setupCodeMatches(`${code}X`, SECRET)).toBe(false);
    expect(setupCodeMatches(undefined, SECRET)).toBe(false);
    expect(setupCodeMatches(42, SECRET)).toBe(false);
    expect(setupCodeMatches(code, undefined)).toBe(false);
    expect(setupCodeMatches(code, "")).toBe(false);
  });
});

describe("normalizeSetupCode", () => {
  it("keeps letters and digits, in upper case", () => {
    expect(normalizeSetupCode(" ab-cd 23 ")).toBe("ABCD23");
  });
});
