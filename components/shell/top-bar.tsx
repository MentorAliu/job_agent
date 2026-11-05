import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/dal/session";
import { getTopBar } from "@/lib/dal/top-bar";
import { topBarQuery } from "@/lib/jobs/queries";
import { getQueryClient } from "@/lib/query-client";

import { BrandMark } from "./brand";
import { TopBarStatus } from "./top-bar-status";

/**
 * Above every page: the sidebar toggle, how the search is doing, new roles
 * and the next thing to do. On a phone it carries the app's name instead of
 * the toggle, since the sidebar is tucked behind More.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-sm sm:px-6">
      <SidebarTrigger className="-ml-1.5 text-muted-foreground max-md:hidden" />
      <Separator
        orientation="vertical"
        className="mr-1 data-vertical:h-5 data-vertical:self-center max-md:hidden"
      />
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
      >
        <BrandMark />
        {/* A phone keeps the room for how the search is doing. */}
        <span className="text-[0.9375rem] font-semibold tracking-tight max-sm:sr-only">
          Job Agent
        </span>
      </Link>
      <Suspense fallback={<TopBarSkeleton />}>
        <TopBarLoader />
      </Suspense>
    </header>
  );
}

/**
 * Reads the bar on the server, so it arrives filled in. In the browser it
 * stays in TanStack Query, which keeps it current as roles and emails change.
 */
async function TopBarLoader() {
  await requireUser();
  const queryClient = getQueryClient();
  // If it fails here, the browser loads it instead.
  await queryClient
    .query({ ...topBarQuery(), queryFn: () => getTopBar() })
    .catch(() => undefined);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TopBarStatus />
    </HydrationBoundary>
  );
}

function TopBarSkeleton() {
  return (
    <div className="flex flex-1 items-center gap-2">
      <Skeleton className="h-4 w-64 max-md:hidden" />
      <Skeleton className="ml-auto h-8 w-36 max-md:w-16" />
    </div>
  );
}
