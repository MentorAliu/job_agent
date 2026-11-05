import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getOptionalUser } from "@/lib/dal/session";
import { appOrigin } from "@/lib/extension/origin";
import { zip } from "@/lib/extension/zip";

/** The extension's files. next.config.ts traces them into this route. */
const FILES = [
  "manifest.json",
  "config.js",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
];

/**
 * The form filler as a ZIP for Chrome's Load unpacked, set up for this app:
 * its address goes in the manifest and config.js.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  if (!(await getOptionalUser())) {
    return NextResponse.redirect(new URL("/sign-in", origin));
  }
  const files = await Promise.all(
    FILES.map(async (name) => {
      const text = await readFile(
        path.join(process.cwd(), "extension", name),
        "utf8",
      );
      return {
        path: `job-agent-form-filler/${name}`,
        data: new TextEncoder().encode(
          text.replaceAll("__APP_ORIGIN__", origin),
        ),
      };
    }),
  );
  const archive = zip(files);
  return new Response(archive.buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="job-agent-form-filler.zip"',
      "cache-control": "no-store",
    },
  });
}
