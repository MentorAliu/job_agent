import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@vercel/blob", () => blob);

import { createVercelBlobStorage } from "./vercel-blob";

describe("Vercel Blob storage driver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a private blob that a retry may overwrite", async () => {
    const storage = createVercelBlobStorage();
    await storage.put("cv/abc.pdf", new TextEncoder().encode("hello"));

    expect(blob.put).toHaveBeenCalledWith("cv/abc.pdf", Buffer.from("hello"), {
      access: "private",
      allowOverwrite: true,
    });
  });

  it("reads a private blob from storage rather than the cache", async () => {
    blob.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response("hello").body,
    });
    const storage = createVercelBlobStorage();

    expect(await storage.get("cv/abc.pdf")).toEqual(
      new TextEncoder().encode("hello"),
    );
    expect(blob.get).toHaveBeenCalledWith("cv/abc.pdf", {
      access: "private",
      useCache: false,
    });
  });

  it("treats a missing blob as null", async () => {
    blob.get.mockResolvedValueOnce(null);
    const storage = createVercelBlobStorage();
    expect(await storage.get("missing.pdf")).toBeNull();
  });

  it("deletes a blob", async () => {
    const storage = createVercelBlobStorage();
    await storage.delete("cv/abc.pdf");
    expect(blob.del).toHaveBeenCalledWith("cv/abc.pdf");
  });

  it.each(["../escape.pdf", "/abs.pdf", ""])(
    "rejects the key %j without calling Blob",
    async (key) => {
      const storage = createVercelBlobStorage();
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(storage.get(key)).rejects.toThrow("Invalid storage key");
      expect(blob.put).not.toHaveBeenCalled();
      expect(blob.get).not.toHaveBeenCalled();
    },
  );
});
