import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { assertValidKey, type Storage } from "./types";

/** Stores files on local disk under `rootDir` (the `files` volume in Docker). */
export function createLocalStorage(rootDir: string): Storage {
  const root = resolve(rootDir);

  function pathFor(key: string): string {
    assertValidKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    return path;
  }

  return {
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
