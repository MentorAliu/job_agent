// Better Auth settings shared by the app (lib/dal/auth.ts) and the schema
// generator (lib/auth/cli.ts). Keep this file free of `server-only` and `@/`
// imports: the Better Auth CLI loads it outside Next.js.
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { SIGN_UP_CLOSED, WRONG_SETUP_CODE } from "./errors";
import { setupCodeMatches } from "./setup-code";

/**
 * Everything but the database. Each copy of the app has one account: the
 * first sign-up creates it, and only with the setup code that comes from
 * `secret` (lib/auth/setup-code.ts). Once it exists, sign-up is closed.
 */
export function authOptions(secret: string | undefined) {
  return {
    emailAndPassword: { enabled: true },
    // Better Auth limits requests in production, and sign-in and sign-up to
    // 3 tries in 10 seconds. Counted in the database, so the limit holds on
    // Vercel too, where each function instance has its own memory.
    rateLimit: { storage: "database" },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const users = context
              ? await context.context.adapter.count({ model: "user" })
              : 1;
            if (users > 0) {
              throw APIError.from("FORBIDDEN", {
                code: SIGN_UP_CLOSED,
                message: "The account already exists. Sign in instead.",
              });
            }
            const body: unknown = context?.body;
            const given =
              typeof body === "object" && body !== null && "setupCode" in body
                ? body.setupCode
                : undefined;
            if (!setupCodeMatches(given, secret)) {
              throw APIError.from("FORBIDDEN", {
                code: WRONG_SETUP_CODE,
                message: "That setup code doesn't match.",
              });
            }
          },
        },
      },
    },
    // Must stay last, so cookies set by server-side auth calls reach the browser.
    plugins: [nextCookies()],
  } satisfies Omit<BetterAuthOptions, "database">;
}
