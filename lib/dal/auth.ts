import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";

import * as authSchema from "@/db/auth-schema";
import { authOptions } from "@/lib/auth/options";

import { db } from "./db";

// Better Auth reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment.
function createAuth() {
  return betterAuth({
    ...authOptions(process.env.BETTER_AUTH_SECRET),
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

/**
 * Created on first use: in production Better Auth throws when the secret is
 * missing, and `next build` runs without one.
 */
export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
