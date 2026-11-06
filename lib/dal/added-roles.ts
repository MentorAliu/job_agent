import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";

import { addedRole, job } from "@/db/schema";
import type { JobStatus } from "@/lib/schemas/tracker";
import { getSearchInputs } from "@/lib/pipeline/runs";
import {
  ADDED_ROLE_STALE_MS,
  type AddRole,
  type AddedRoleStatus,
} from "@/lib/schemas/added-role";

import { db } from "./db";
import { getCurrentUser } from "./session";

// Roles the owner adds by hand on the Roles page. Claude reads each one in
// an Inngest step (inngest/add-role.ts); these are the owner's reads and
// writes.

/** How long an added role stays listed on the Roles page. */
const RECENT_MS = 24 * 3600e3;
/** How many added roles the Roles page lists. */
const RECENT_COUNT = 3;

const STALE_NOTE = "Adding it didn't finish. Add it again.";

export class AddRoleError extends Error {
  name = "AddRoleError";
}

/** Saves a role to add, for Claude to read. Returns its id. */
export async function addRole(
  input: AddRole,
  now = new Date(),
): Promise<string> {
  await getCurrentUser();
  const { preferences } = await getSearchInputs();
  if (!preferences) {
    throw new AddRoleError(
      "Save your job preferences first, so the app can check the role is open to you.",
    );
  }
  const [busy] = await db
    .select({ id: addedRole.id })
    .from(addedRole)
    .where(
      and(
        eq(addedRole.url, input.url),
        eq(addedRole.status, "reading"),
        gt(addedRole.createdAt, new Date(now.getTime() - ADDED_ROLE_STALE_MS)),
      ),
    )
    .limit(1);
  if (busy) throw new AddRoleError("That role is being added already.");
  const [saved] = await db
    .insert(addedRole)
    .values({ url: input.url, text: input.text })
    .returning({ id: addedRole.id });
  return saved!.id;
}

/** Marks an added role failed when its event couldn't be sent. */
export async function markAddUnsent(id: string, note: string): Promise<void> {
  await getCurrentUser();
  await db
    .update(addedRole)
    .set({ status: "failed", note })
    .where(and(eq(addedRole.id, id), eq(addedRole.status, "reading")));
}

export type AddedRoleView = {
  id: string;
  /** The site the link is on, such as "jobs.ashbyhq.com". */
  site: string;
  url: string;
  status: AddedRoleStatus;
  note: string | null;
  /** The role it became, once read. */
  role: {
    id: string;
    title: string;
    company: string;
    status: JobStatus;
  } | null;
};

/** The last few roles the owner added in the past day, newest first. */
export async function getRecentAddedRoles(
  now = new Date(),
): Promise<AddedRoleView[]> {
  await getCurrentUser();
  const rows = await db
    .select({
      id: addedRole.id,
      url: addedRole.url,
      status: addedRole.status,
      note: addedRole.note,
      createdAt: addedRole.createdAt,
      jobId: job.id,
      title: job.title,
      company: job.company,
      jobStatus: job.status,
    })
    .from(addedRole)
    .leftJoin(job, eq(addedRole.jobId, job.id))
    .where(gt(addedRole.createdAt, new Date(now.getTime() - RECENT_MS)))
    .orderBy(desc(addedRole.createdAt), desc(addedRole.id))
    .limit(RECENT_COUNT);
  return rows.map((row) => {
    const stale =
      row.status === "reading" &&
      now.getTime() - row.createdAt.getTime() > ADDED_ROLE_STALE_MS;
    return {
      id: row.id,
      site: siteOf(row.url),
      url: row.url,
      status: stale ? "failed" : row.status,
      note: stale ? STALE_NOTE : row.note,
      role:
        row.jobId &&
        row.title !== null &&
        row.company !== null &&
        row.jobStatus !== null
          ? {
              id: row.jobId,
              title: row.title,
              company: row.company,
              status: row.jobStatus,
            }
          : null,
    };
  });
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
