import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ApplyKitView } from "@/components/jobs/apply-kit";
import { JobSaveErrors } from "@/components/jobs/job-actions";
import { RoleDetails } from "@/components/jobs/role-details";
import { Skeleton } from "@/components/ui/skeleton";
import { getApplyKit } from "@/lib/dal/apply-kit";
import { getRoleEmails } from "@/lib/dal/emails";
import { getJobDetail } from "@/lib/dal/jobs";
import { requireUser } from "@/lib/dal/session";
import {
  applyKitQuery,
  jobDetailQuery,
  roleEmailsQuery,
} from "@/lib/jobs/queries";
import { getQueryClient } from "@/lib/query-client";

export const metadata: Metadata = { title: "Role" };

/**
 * One role: its apply kit and, once applied, its emails, with why it scored,
 * its facts and its timeline below. Each streams in its own Suspense
 * section, read on the server and handed to TanStack Query, which keeps it
 * current in the browser.
 */
export default function ApplyKitPage({ params }: PageProps<"/jobs/[id]">) {
  const id = params.then(({ id }) => {
    const jobId = z.uuid().safeParse(id);
    if (!jobId.success) notFound();
    return jobId.data;
  });
  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={<KitSkeleton />}>
        {id.then((jobId) => (
          <KitLoader id={jobId} />
        ))}
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        {id.then((jobId) => (
          <DetailsLoader id={jobId} />
        ))}
      </Suspense>
    </div>
  );
}

// A role that isn't there throws notFound() from inside its query, which
// rejects the prefetch and shows the 404 page.

async function KitLoader({ id }: { id: string }) {
  await requireUser();
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.query({
      ...applyKitQuery(id),
      queryFn: async () => (await getApplyKit(id)) ?? notFound(),
    }),
    queryClient.query({
      ...roleEmailsQuery(id),
      queryFn: () => getRoleEmails(id),
    }),
  ]);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ApplyKitView jobId={id} />
      <JobSaveErrors />
    </HydrationBoundary>
  );
}

async function DetailsLoader({ id }: { id: string }) {
  await requireUser();
  const queryClient = getQueryClient();
  await queryClient.query({
    ...jobDetailQuery(id),
    queryFn: async () => (await getJobDetail(id)) ?? notFound(),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RoleDetails jobId={id} />
    </HydrationBoundary>
  );
}

function KitSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading the apply kit…</span>
      <Skeleton className="h-4 w-16" />
      <div className="flex items-start gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-[32rem] rounded-xl" />
        <Skeleton className="h-80 rounded-xl max-lg:hidden" />
      </div>
    </div>
  );
}
