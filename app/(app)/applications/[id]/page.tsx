import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ApplicationView } from "@/components/applications/application-view";
import { JobSaveErrors } from "@/components/jobs/job-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { isApplied } from "@/lib/applications/progress";
import { getApplyKit } from "@/lib/dal/apply-kit";
import { getRoleEmails } from "@/lib/dal/emails";
import { getJobDetail } from "@/lib/dal/jobs";
import { getProfileName } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";
import {
  applyKitQuery,
  jobDetailQuery,
  roleEmailsQuery,
} from "@/lib/jobs/queries";
import { getQueryClient } from "@/lib/query-client";

export const metadata: Metadata = { title: "Application" };

/**
 * One application: how far it got, what's the owner's to do, and the
 * conversation with the company. Read on the server and handed to TanStack
 * Query, which keeps it current in the browser. A role that isn't applied
 * to yet has its apply kit instead.
 */
export default function ApplicationPage({
  params,
}: PageProps<"/applications/[id]">) {
  const id = params.then(({ id }) => {
    const jobId = z.uuid().safeParse(id);
    if (!jobId.success) notFound();
    return jobId.data;
  });
  return (
    <Suspense fallback={<ApplicationSkeleton />}>
      {id.then((jobId) => (
        <ApplicationLoader id={jobId} />
      ))}
    </Suspense>
  );
}

// A role that isn't there throws notFound() from inside its query, which
// rejects the prefetch and shows the 404 page.

async function ApplicationLoader({ id }: { id: string }) {
  const user = await requireUser();
  const queryClient = getQueryClient();
  const [job, profileName] = await Promise.all([
    queryClient.query({
      ...jobDetailQuery(id),
      queryFn: async () => (await getJobDetail(id)) ?? notFound(),
    }),
    getProfileName(),
    queryClient.query({
      ...applyKitQuery(id),
      queryFn: async () => (await getApplyKit(id)) ?? notFound(),
    }),
    queryClient.query({
      ...roleEmailsQuery(id),
      queryFn: () => getRoleEmails(id),
    }),
  ]);
  if (!isApplied(job.status)) redirect(`/jobs/${id}`);
  // The name the sidebar shows, so the owner's emails carry the same letter.
  const name = profileName?.split(/\s+/)[0] || user.name || user.email;
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ApplicationView jobId={id} ownerInitial={name.charAt(0).toUpperCase()} />
      <JobSaveErrors />
    </HydrationBoundary>
  );
}

function ApplicationSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading the application…</span>
      <Skeleton className="h-4 w-24" />
      <div className="flex items-start gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl max-xl:hidden" />
      </div>
    </div>
  );
}
