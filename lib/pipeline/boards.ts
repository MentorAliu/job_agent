import "server-only";

import { desc, eq } from "drizzle-orm";

import { job } from "@/db/schema";
import { db } from "@/lib/dal/db";

// The roles behind the company boards each search checks, for an Inngest
// step that runs with no signed-in user.

/** Enough recent roles to find MAX_WATCHED_BOARDS companies in. */
const ROLES_LOOKED_AT = 500;

/** The links and companies of roles the owner can take, newest first. */
export async function getEligibleRoleLinks(): Promise<
  { canonicalUrl: string; applyUrl: string | null; company: string }[]
> {
  return db
    .select({
      canonicalUrl: job.canonicalUrl,
      applyUrl: job.applyUrl,
      company: job.company,
    })
    .from(job)
    .where(eq(job.eligibility, "eligible"))
    .orderBy(desc(job.foundAt))
    .limit(ROLES_LOOKED_AT);
}
