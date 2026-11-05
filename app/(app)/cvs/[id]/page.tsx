import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { BuiltCvView } from "@/components/cvs/built-cv";
import { Skeleton } from "@/components/ui/skeleton";
import { getBuiltCv } from "@/lib/dal/cvs";
import { requireUser } from "@/lib/dal/session";
import { builtCvQuery } from "@/lib/cvs/queries";
import { getQueryClient } from "@/lib/query-client";

export const metadata: Metadata = { title: "CV" };

/**
 * One built CV. The page reads it on the server and hands it to TanStack
 * Query, which follows it in the browser while Claude writes it.
 */
export default function BuiltCvPage({ params }: PageProps<"/cvs/[id]">) {
  const id = params.then(({ id }) => {
    const cvId = z.uuid().safeParse(id);
    if (!cvId.success) notFound();
    return cvId.data;
  });
  return (
    <Suspense fallback={<CvSkeleton />}>
      {id.then((cvId) => (
        <CvLoader id={cvId} />
      ))}
    </Suspense>
  );
}

function CvSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading the CV…</span>
      <Skeleton className="h-16 w-full max-w-md" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-[min(80dvh,56rem)] min-h-96 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

// A CV that isn't there throws notFound() from inside its query, which
// rejects the prefetch and shows the 404 page.
async function CvLoader({ id }: { id: string }) {
  await requireUser();
  const queryClient = getQueryClient();
  await queryClient.query({
    ...builtCvQuery(id),
    queryFn: async () => (await getBuiltCv(id)) ?? notFound(),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BuiltCvView id={id} />
    </HydrationBoundary>
  );
}
