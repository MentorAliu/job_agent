import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { RETURN_TO_PARAM, returnPath } from "@/lib/auth/return-to";

const PUBLIC_PATHS = new Set(["/sign-in"]);

/**
 * A quick cookie check that sends signed-out visitors to /sign-in, which
 * brings them back to the page they asked for. It doesn't validate the
 * session: lib/dal does that on every read and write.
 */
export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  const signIn = new URL("/sign-in", request.url);
  const back = returnPath(request.nextUrl.pathname + request.nextUrl.search);
  if (back) signIn.searchParams.set(RETURN_TO_PARAM, back);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Route Handlers under /api check the session themselves (or are public, like
  // /api/auth and /api/inngest), so the proxy skips them and static files.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon\\.ico|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
