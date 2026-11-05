import { NextResponse } from "next/server";

import { JobNotFoundError } from "@/lib/dal/jobs";
import { UnauthorizedError } from "@/lib/dal/session";

/**
 * Runs one of the extension's requests: 401 when the owner isn't signed in
 * to the app in this browser, 404 for a role that's gone. Never cached.
 */
export async function extensionResponse(
  handle: () => Promise<unknown>,
): Promise<Response> {
  try {
    return NextResponse.json(await handle(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "signed_out" }, { status: 401 });
    }
    if (error instanceof JobNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  }
}

export function badRequest(): Response {
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}

/**
 * Only a JSON body counts. A page on another site can't send one with the
 * owner's cookie without the app's say-so, and the session cookie isn't
 * sent on another site's POST anyway (SameSite=Lax).
 */
export function isJson(request: Request): boolean {
  return (
    request.headers.get("content-type")?.startsWith("application/json") ?? false
  );
}
