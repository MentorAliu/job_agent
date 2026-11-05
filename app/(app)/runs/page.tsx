import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RunHistory } from "@/components/runs/run-history";
import { SearchNow } from "@/components/runs/search-now";
import {
  CostByStep,
  EarlierMonths,
  SpendPerDay,
  SpendStats,
} from "@/components/runs/spend-overview";
import { Skeleton } from "@/components/ui/skeleton";
import { getLatestRun, listRuns } from "@/lib/dal/runs";
import { requireUser } from "@/lib/dal/session";
import { isDailyRunOn } from "@/lib/dal/settings";
import { getMonthActivity, getSpendSummary } from "@/lib/dal/spend";

export const metadata: Metadata = { title: "Runs and spend" };

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export default function RunsPage({ searchParams }: PageProps<"/runs">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runs and spend"
        description="Every search, and what Claude has cost, by step. Searches run every morning by themselves."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-32 rounded-lg" />}>
            <SearchNowLoader />
          </Suspense>
        }
      />
      <Suspense fallback={<RunsSkeleton />}>
        <RunsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Search now, for a search before the daily one. */
async function SearchNowLoader() {
  await requireUser();
  return <SearchNow latest={await getLatestRun()} />;
}

function RunsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </>
  );
}

async function RunsLoader({
  searchParams,
}: {
  searchParams: PageProps<"/runs">["searchParams"];
}) {
  await requireUser();
  const now = new Date();
  const { page } = await searchParams;
  const [spend, activity, history, dailyRun] = await Promise.all([
    getSpendSummary(now),
    getMonthActivity(now),
    listRuns(pageSchema.parse(page)),
    isDailyRunOn(),
  ]);
  return (
    <>
      <SpendStats activity={activity} now={now} />
      <SpendPerDay spend={spend} now={now} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <RunHistory history={history} dailyRun={dailyRun} />
        <div className="flex flex-col gap-4">
          <CostByStep spend={spend} />
          <EarlierMonths spend={spend} />
        </div>
      </div>
    </>
  );
}
