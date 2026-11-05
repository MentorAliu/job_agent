import { describe, expect, it } from "vitest";

import { crc32, zip } from "./zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes an archive with each file stored whole", () => {
    const data = new TextEncoder().encode('{"name":"x"}');
    const archive = zip([{ path: "folder/manifest.json", data }]);
    const view = new DataView(archive.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.length - 12, true)).toBe(1);
    const text = new TextDecoder().decode(archive);
    expect(text).toContain("folder/manifest.json");
    expect(text).toContain('{"name":"x"}');
  });
});
