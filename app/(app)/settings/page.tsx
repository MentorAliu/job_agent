import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getLatestEngineCheck } from "@/lib/dal/engine-check";
import { requireUser } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { DAILY_RUN_TIME, nextDailyRunDay } from "@/lib/jobs/today";
import { getQueryClient } from "@/lib/query-client";
import { engineCheckQuery } from "@/lib/setup/queries";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="The daily search, what the agents run on and may spend, the form filler, and how the app looks. Everything else runs by itself."
      />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsLoader />
      </Suspense>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}

async function SettingsLoader() {
  await requireUser();
  const settings = await getSettings();
  const engine = settings.values.agentEngine;
  const queryClient = getQueryClient();
  await queryClient.query({
    ...engineCheckQuery(engine),
    queryFn: () => getLatestEngineCheck(engine),
  });
  const day = nextDailyRunDay(settings.values.timeZone);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsForm
        settings={settings}
        nextRun={`${day} at ${DAILY_RUN_TIME}`}
      />
    </HydrationBoundary>
  );
}
