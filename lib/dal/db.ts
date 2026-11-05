import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { relations } from "@/db/relations";

function createDb() {
  // The pool connects on the first query, so `next build` works without a database.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // On Vercel, keeps the function alive until idle connections are closed.
  // Does nothing anywhere else.
  attachDatabasePool(pool);
  return drizzle({ client: pool, relations });
}

export type Db = ReturnType<typeof createDb>;

// One pool per process, also across hot reloads in development.
const globalForDb = globalThis as typeof globalThis & { jobAgentDb?: Db };

export const db: Db = (globalForDb.jobAgentDb ??= createDb());
