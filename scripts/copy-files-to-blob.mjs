// One-off for the move to Vercel: copies stored files (CVs, generated PDFs)
// into Vercel Blob as private blobs, under the same keys the app uses.
//
//   docker compose cp web:/data/files ./.data/export-files
//   node scripts/copy-files-to-blob.mjs ./.data/export-files
//
// Needs BLOB_READ_WRITE_TOKEN in the environment or in .env. Running it again
// overwrites the same blobs, so it's safe to repeat.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { put } from "@vercel/blob";
import { config } from "dotenv";

config({ quiet: true });

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/copy-files-to-blob.mjs <files-dir>");
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Set BLOB_READ_WRITE_TOKEN first.");
  process.exit(1);
}

const entries = await readdir(root, { recursive: true, withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));

for (const path of files) {
  const key = relative(root, path).split(sep).join("/");
  await put(key, await readFile(path), {
    access: "private",
    allowOverwrite: true,
  });
  console.log(`copied ${key}`);
}
console.log(`Done: ${files.length} file(s) copied.`);
