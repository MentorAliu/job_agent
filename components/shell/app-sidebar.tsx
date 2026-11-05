"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { BrandMark } from "./brand";
import { isCurrent, MAIN_NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { useJobCounts } from "./use-job-counts";

type Badge = { text: string; label: string; className: string };

/**
 * The sidebar: the pages, with how many kits are ready to send, and a footer
 * the layout fills with the latest run and the account. On a phone it opens
 * as a sheet from the tab bar's More button.
 */
export function AppSidebar({ footer }: { footer: React.ReactNode }) {
  return (
    <Sidebar>
      <SidebarHeader className="px-3 pt-4 pb-1">
        <Link
          href="/"
          className="flex items-center gap-2.5 self-start rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BrandMark />
          <span className="text-[0.9375rem] font-semibold tracking-tight">
            Job Agent
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main">
          {/* The current page is only known at request time on dynamic
              routes, so the prerendered shell marks none of the links. */}
          <Suspense fallback={<SidebarNav pathname={null} />}>
            <CurrentSidebarNav />
          </Suspense>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-2.5 p-3">{footer}</SidebarFooter>
    </Sidebar>
  );
}

function CurrentSidebarNav() {
  return <SidebarNav pathname={usePathname()} />;
}

function SidebarNav({ pathname }: { pathname: string | null }) {
  const counts = useJobCounts();
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };

  const badges: Partial<Record<NavItem["href"], Badge>> = {};
  if (counts.readyToSend > 0) {
    badges["/jobs"] = {
      text: String(counts.readyToSend),
      label: `${counts.readyToSend} ready to send`,
      className: "bg-primary text-primary-foreground",
    };
  }
  if (counts.yourTurn > 0) {
    badges["/applications"] = {
      text: String(counts.yourTurn),
      label: `${counts.yourTurn} waiting for your reply`,
      className: "bg-warning text-warning-foreground",
    };
  }

  return (
    <>
      <SidebarGroup className="px-3">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            {MAIN_NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                current={isCurrent(item.href, pathname)}
                badge={badges[item.href]}
                onNavigate={close}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="px-3">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            {SETTINGS_NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                current={isCurrent(item.href, pathname)}
                onNavigate={close}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function NavLink({
  item,
  current,
  badge,
  onNavigate,
}: {
  item: NavItem;
  current: boolean;
  badge?: Badge;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        render={
          <Link
            href={item.href}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
          />
        }
        className="h-8.5 gap-2.5 px-2.5 font-medium text-muted-foreground hover:text-sidebar-foreground data-active:bg-card data-active:text-sidebar-foreground data-active:shadow-xs data-active:ring-1 data-active:ring-sidebar-border data-active:[&>svg]:text-primary"
      >
        <Icon aria-hidden />
        <span>{item.label}</span>
        {badge ? (
          <>
            <span
              aria-hidden
              className={cn(
                "ml-auto rounded-full px-1.75 text-[0.6875rem] leading-5 font-semibold tabular-nums",
                badge.className,
              )}
            >
              {badge.text}
            </span>
            <span className="sr-only">, {badge.label}</span>
          </>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
