import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ApplicationsList } from "@/components/applications/applications-list";
import { PastedEmails } from "@/components/emails/pasted-emails";
import { JobSaveErrors } from "@/components/jobs/job-actions";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { loadApplicationsParams } from "@/lib/applications/params";
import { listApplications } from "@/lib/dal/applications";
import { getApplicationChoices, getPastedEmails } from "@/lib/dal/emails";
import { requireUser } from "@/lib/dal/session";
import { pastedEmailsQuery } from "@/lib/jobs/queries";
import { getQueryClient } from "@/lib/query-client";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage({
  searchParams,
}: PageProps<"/applications">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Applications"
        description="Every role you applied to. Paste each email a company sends you: the app files it, moves the role on and writes your reply."
      />
      <Suspense fallback={<ApplicationsSkeleton />}>
        <ApplicationsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ApplicationsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading the applications…</span>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-10 w-full max-w-2xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/** Reads the filters from the URL and loads them on the server. */
async function ApplicationsLoader({
  searchParams,
}: {
  searchParams: PageProps<"/applications">["searchParams"];
}) {
  await requireUser();
  const view = loadApplicationsParams(await searchParams);
  // The pasted emails go to TanStack Query, which polls them while Claude
  // reads one. The list stays on the server.
  const queryClient = getQueryClient();
  const [page, choices] = await Promise.all([
    listApplications(view),
    getApplicationChoices(),
    queryClient.query({
      ...pastedEmailsQuery(),
      queryFn: () => getPastedEmails(),
    }),
  ]);
  return (
    <>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <PastedEmails choices={choices} />
      </HydrationBoundary>
      <ApplicationsList view={view} page={page} />
      <JobSaveErrors />
    </>
  );
}
