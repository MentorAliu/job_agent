import "server-only";

import { createLocalStorage } from "./local";
import type { Storage } from "./types";
import { createVercelBlobStorage } from "./vercel-blob";

export type { Storage } from "./types";

let storage: Storage | undefined;

/**
 * The storage driver picked by STORAGE_DRIVER. Created on first use, so a
 * missing variable never breaks `next build`.
 */
export function getStorage(): Storage {
  storage ??= createStorage(process.env.STORAGE_DRIVER ?? "local");
  return storage;
}

function createStorage(driver: string): Storage {
  switch (driver) {
    case "local":
      return createLocalStorage(process.env.STORAGE_DIR ?? "./.data/files");
    case "vercel-blob":
      return createVercelBlobStorage();
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  }
}
