import type { Metadata } from "next";
import { Suspense } from "react";

import { MarkRolesSeen } from "@/components/jobs/mark-roles-seen";
import { RolesList } from "@/components/jobs/roles-list";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { listJobs } from "@/lib/dal/jobs";
import { readRolesSeen } from "@/lib/dal/roles-seen";
import { requireUser } from "@/lib/dal/session";
import {
  loadRolesParams,
  rolesListParams,
  serializeRolesParams,
} from "@/lib/jobs/list-params";
import { newSince } from "@/lib/jobs/new-roles";

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage({ searchParams }: PageProps<"/jobs">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles"
        description="Every role the searches found. The app picks the strong ones and writes their kits; open a role to send it. Once you apply, the role moves to Applications."
      />
      <Suspense fallback={<RolesSkeleton />}>
        <RolesLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function RolesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading the roles…</span>
      <Skeleton className="h-10 w-full max-w-2xl" />
      <Skeleton className="h-8 w-full max-w-3xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/**
 * Reads the tab, filters, order and page from the URL and loads them on the
 * server. New starts where the owner's last visit ended.
 */
async function RolesLoader({
  searchParams,
}: {
  searchParams: PageProps<"/jobs">["searchParams"];
}) {
  await requireUser();
  const view = loadRolesParams(await searchParams);
  const since = newSince(await readRolesSeen(), new Date());
  const page = await listJobs(rolesListParams(view, since), {
    newSince: since,
  });
  return (
    <>
      <RolesList view={view} page={page} newSince={since.toISOString()} />
      {/* Each view counts as a look at the page. */}
      <MarkRolesSeen key={serializeRolesParams("", view)} />
    </>
  );
}
