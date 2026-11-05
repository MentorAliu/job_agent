import "server-only";

import { count } from "drizzle-orm";
import { connection } from "next/server";

import { user } from "@/db/auth-schema";
import { setupCodeFor } from "@/lib/auth/setup-code";

import { db } from "./db";

/**
 * Whether this copy's one account exists yet. The only read without a
 * session: the sign-in page shows "Create your account" until it does.
 */
export async function ownerExists(): Promise<boolean> {
  // Not at build time: the database may not be there.
  await connection();
  const [row] = await db.select({ users: count() }).from(user);
  return (row?.users ?? 0) > 0;
}

let announced = false;

/**
 * Writes the setup code to the server log, once per server start, for
 * whoever runs this copy but didn't use `scripts/setup.mjs` (on Vercel, it
 * shows in the project's Logs). Only called while no account exists.
 */
export function announceSetupCode(): void {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (announced || !secret) return;
  announced = true;
  console.info(
    `[job-agent] No account yet. Setup code to create it: ${setupCodeFor(secret)}`,
  );
}
