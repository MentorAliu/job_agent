import { del, get, put } from "@vercel/blob";

import { assertValidKey, type Storage } from "./types";

/**
 * Stores files as private blobs in Vercel Blob, under the same keys as the
 * local driver. The SDK reads BLOB_READ_WRITE_TOKEN from the environment.
 */
export function createVercelBlobStorage(): Storage {
  return {
    async put(key, data) {
      assertValidKey(key);
      // A retried step writes the same key again.
      await put(key, Buffer.from(data), {
        access: "private",
        allowOverwrite: true,
      });
    },
    async get(key) {
      assertValidKey(key);
      // Bypass the CDN cache, which could still hold an overwritten file.
      const result = await get(key, { access: "private", useCache: false });
      if (result?.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(key) {
      assertValidKey(key);
      await del(key);
    },
  };
}
