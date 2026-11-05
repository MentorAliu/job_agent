import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { RunView } from "@/components/runs/run-view";
import { Spinner } from "@/components/ui/spinner";
import { getRun } from "@/lib/dal/runs";
import { requireUser } from "@/lib/dal/session";
import { getQueryClient } from "@/lib/query-client";
import { runQuery } from "@/lib/run-polling";

export const metadata: Metadata = { title: "Search run" };

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ id }) => (
        <RunLoader id={id} />
      ))}
    </Suspense>
  );
}

async function RunLoader({ id }: { id: string }) {
  await requireUser();
  const runId = z.uuid().safeParse(id);
  if (!runId.success) notFound();
  const queryClient = getQueryClient();
  // A run that isn't there throws notFound() from inside its query, which
  // rejects the prefetch and shows the 404 page.
  await queryClient.query({
    ...runQuery(runId.data),
    queryFn: async () => (await getRun(runId.data)) ?? notFound(),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RunView runId={runId.data} />
    </HydrationBoundary>
  );
}
