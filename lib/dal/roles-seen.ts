import "server-only";

import { cookies } from "next/headers";

import {
  markSeen,
  parseRolesSeen,
  ROLES_SEEN_COOKIE,
  ROLES_SEEN_MAX_AGE_S,
  serializeRolesSeen,
  type RolesSeen,
} from "@/lib/jobs/new-roles";

import { getCurrentUser } from "./session";

// The owner's visits to the Roles page, for its New filter and the top
// bar's count. They're a cookie rather than a row: each browser keeps its
// own, and nothing in the database changes.

/** The visits this browser has recorded, or null before the first one. */
export async function readRolesSeen(): Promise<RolesSeen | null> {
  const store = await cookies();
  return parseRolesSeen(store.get(ROLES_SEEN_COOKIE)?.value);
}

/** Records that the owner has the Roles page open now. */
export async function markRolesSeen(now = new Date()): Promise<void> {
  await getCurrentUser();
  const store = await cookies();
  const seen = markSeen(
    parseRolesSeen(store.get(ROLES_SEEN_COOKIE)?.value),
    now,
  );
  store.set(ROLES_SEEN_COOKIE, serializeRolesSeen(seen), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ROLES_SEEN_MAX_AGE_S,
  });
}
