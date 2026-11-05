import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalStorage } from "./local";

describe("local storage driver", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "job-agent-storage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes, reads and deletes a file", async () => {
    const storage = createLocalStorage(dir);
    const bytes = new TextEncoder().encode("hello");

    await storage.put("cv/abc.pdf", bytes);
    expect(await storage.get("cv/abc.pdf")).toEqual(bytes);

    await storage.delete("cv/abc.pdf");
    expect(await storage.get("cv/abc.pdf")).toBeNull();
  });

  it("treats a missing file as null and deleting it as a no-op", async () => {
    const storage = createLocalStorage(dir);
    expect(await storage.get("missing.pdf")).toBeNull();
    await expect(storage.delete("missing.pdf")).resolves.toBeUndefined();
  });

  it.each(["../escape.pdf", "cv/../../escape.pdf", "/abs.pdf", "", "a//b"])(
    "rejects the key %j",
    async (key) => {
      const storage = createLocalStorage(dir);
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow(
        "Invalid storage key",
      );
    },
  );
});
