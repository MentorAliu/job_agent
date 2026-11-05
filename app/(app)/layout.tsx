import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Providers } from "@/components/providers";
import { AccountRow } from "@/components/shell/account-row";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { RunCard, RunCardSkeleton } from "@/components/shell/run-card";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getOptionalUser } from "@/lib/dal/session";
import { getSetupDone } from "@/lib/dal/setup";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <Suspense fallback={null}>
        <SetupGate />
      </Suspense>
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:ring-3 focus:ring-ring/50"
        >
          Skip to content
        </a>
        <AppSidebar
          footer={
            <>
              <Suspense fallback={<RunCardSkeleton />}>
                <RunCard />
              </Suspense>
              <Suspense fallback={<Skeleton className="h-9 rounded-md" />}>
                <AccountRow />
              </Suspense>
            </>
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(var(--tab-bar-height)+2.5rem)] outline-none sm:px-6 md:pb-10 lg:px-8"
          >
            {children}
          </main>
        </div>
        <MobileTabBar />
      </SidebarProvider>
    </Providers>
  );
}

/**
 * Until first-run setup is finished, every page of the app sends to it. The
 * proxy has already sent signed-out visitors to /sign-in.
 */
async function SetupGate() {
  if (!(await getOptionalUser())) return null;
  if (!(await getSetupDone())) redirect("/setup");
  return null;
}
