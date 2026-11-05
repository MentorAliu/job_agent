"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { isCurrent, MAIN_NAV } from "./nav";
import { useJobCounts } from "./use-job-counts";

const TAB =
  "relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[0.6875rem] font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-5";

/** The phone's tabs along the bottom. More opens the sidebar as a sheet. */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex h-(--tab-bar-height) border-t bg-sidebar/95 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden"
    >
      <Suspense fallback={<Tabs pathname={null} />}>
        <CurrentTabs />
      </Suspense>
    </nav>
  );
}

function CurrentTabs() {
  return <Tabs pathname={usePathname()} />;
}

function Tabs({ pathname }: { pathname: string | null }) {
  const counts = useJobCounts();
  const { openMobile, setOpenMobile } = useSidebar();
  const badges: Record<
    string,
    { count: number; label: string; className: string }
  > = {
    "/jobs": {
      count: counts.readyToSend,
      label: "ready to send",
      className: "bg-primary text-primary-foreground",
    },
    "/applications": {
      count: counts.yourTurn,
      label: "waiting for your reply",
      className: "bg-warning text-warning-foreground",
    },
  };

  return (
    <>
      {MAIN_NAV.filter((item) => !item.notOnTabBar).map((item) => {
        const current = isCurrent(item.href, pathname);
        const badge = badges[item.href];
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(TAB, current && "font-semibold text-primary-ink")}
          >
            <Icon aria-hidden />
            {item.shortLabel ?? item.label}
            {badge && badge.count > 0 ? (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 left-[calc(50%+0.375rem)] min-w-4.5 rounded-full px-1.25 text-center text-[0.65625rem] leading-4.25 font-bold tabular-nums",
                    badge.className,
                  )}
                >
                  {badge.count}
                </span>
                <span className="sr-only">
                  , {badge.count} {badge.label}
                </span>
              </>
            ) : null}
          </Link>
        );
      })}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(true)}
        className={TAB}
      >
        <MenuIcon aria-hidden />
        More
      </button>
    </>
  );
}
