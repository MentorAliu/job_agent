import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "./auth";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthorizedError";
  }
}

// Validates the session cookie against the database, once per request.
// headers() comes first: it suspends during prerendering, so Better Auth is
// never created at build time.
const readSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** The signed-in owner, or null. For pages that also work signed out. */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  const session = await readSession();
  if (!session) return null;
  const { id, email, name } = session.user;
  return { id, email, name };
}

/**
 * The signed-in owner. Throws UnauthorizedError without a valid session.
 * Every other function in lib/dal calls this before it touches data.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await getOptionalUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For Server Components: like getCurrentUser, but redirects to /sign-in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getOptionalUser();
  if (!user) redirect("/sign-in");
  return user;
}
