// Entry point for the Better Auth CLI only (`pnpm auth:generate`). The CLI
// reads the options to write db/auth-schema.ts and never connects to the
// database. The app builds its instance in lib/dal/auth.ts.
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";

import { authOptions } from "./options";

export const auth = betterAuth({
  ...authOptions(process.env.BETTER_AUTH_SECRET),
  database: drizzleAdapter(drizzle.mock(), { provider: "pg" }),
});
