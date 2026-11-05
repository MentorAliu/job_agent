import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { PlusIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CvLibrary } from "@/components/cvs/cv-library";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cvListQuery } from "@/lib/cvs/queries";
import { listCvs } from "@/lib/dal/cvs";
import { requireUser } from "@/lib/dal/session";
import { getQueryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CVs" };

export default function CvsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="CVs"
        description="Your uploaded CV and every CV made for you, saved to open again. Edit any of them into a new one, or have Claude build one for a job."
        actions={
          <>
            <Link
              href="/cvs/new"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <SparklesIcon aria-hidden data-icon="inline-start" />
              Build with Claude
            </Link>
            <Link href="/cvs/edit" className={buttonVariants()}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              New CV
            </Link>
          </>
        }
      />
      <Suspense fallback={<CvsSkeleton />}>
        <CvsLoader />
      </Suspense>
    </div>
  );
}

function CvsSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading the CVs…</span>
      <Skeleton className="h-11 w-72" />
      <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2 sm:gap-4 md:grid-cols-3 2xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-60 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

async function CvsLoader() {
  await requireUser();
  const queryClient = getQueryClient();
  await queryClient.query({ ...cvListQuery(), queryFn: () => listCvs() });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CvLibrary />
    </HydrationBoundary>
  );
}
