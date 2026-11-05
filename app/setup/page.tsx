import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Providers } from "@/components/providers";
import { SetupHeader } from "@/components/setup/setup-header";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/dal/session";
import { getSetupState } from "@/lib/dal/setup";
import { getQueryClient } from "@/lib/query-client";
import { setupStateQuery } from "@/lib/setup/queries";

export const metadata: Metadata = { title: "Setup" };

/**
 * First-run setup: the AI provider, the CV and what the owner is looking
 * for, before the app opens. Once it's finished, this page sends to the app.
 */
export default function SetupPage() {
  return (
    <Providers>
      <SetupHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-6 pb-16 outline-none sm:px-6 sm:pt-10"
      >
        <Suspense fallback={<SetupSkeleton />}>
          <SetupLoader />
        </Suspense>
      </main>
    </Providers>
  );
}

function SetupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

async function SetupLoader() {
  await requireUser();
  const queryClient = getQueryClient();
  const state = await queryClient.query({
    ...setupStateQuery(),
    queryFn: getSetupState,
  });
  if (state.done) redirect("/");
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SetupWizard />
    </HydrationBoundary>
  );
}
