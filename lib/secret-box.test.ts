import { describe, expect, it } from "vitest";

import { open, seal } from "./secret-box";

const SECRET = "a-test-secret-that-is-long-enough";

describe("secret box", () => {
  it("opens what it sealed, with the same secret and purpose", () => {
    const sealed = seal('{"tokens":{}}', "codex-login", SECRET);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("tokens");
    expect(open(sealed, "codex-login", SECRET)).toBe('{"tokens":{}}');
  });

  it("seals the same text differently each time", () => {
    expect(seal("x", "codex-login", SECRET)).not.toBe(
      seal("x", "codex-login", SECRET),
    );
  });

  it("can't be opened with another secret or for another purpose", () => {
    const sealed = seal("x", "codex-login", SECRET);
    expect(open(sealed, "codex-login", "another-secret")).toBeNull();
    expect(open(sealed, "something-else", SECRET)).toBeNull();
  });

  it("refuses a changed or malformed value", () => {
    const sealed = seal("hello", "codex-login", SECRET);
    const bytes = Buffer.from(sealed.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(
      open(`v1:${bytes.toString("base64")}`, "codex-login", SECRET),
    ).toBeNull();
    expect(open("v2:abc", "codex-login", SECRET)).toBeNull();
    expect(open("v1:", "codex-login", SECRET)).toBeNull();
  });
});
