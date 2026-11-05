import {
  BriefcaseBusinessIcon,
  FileTextIcon,
  InboxIcon,
  LayoutDashboardIcon,
  Settings2Icon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

export type NavHref =
  "/" | "/jobs" | "/applications" | "/cvs" | "/profile" | "/settings";

export type NavItem = {
  href: NavHref;
  label: string;
  /** On the phone's tab bar, where there's less room. */
  shortLabel?: string;
  /** Left off the phone's tab bar, which has room for four; More has it. */
  notOnTabBar?: boolean;
  icon: LucideIcon;
};

/**
 * What the owner reads: how the search is going, the roles, the
 * applications and their emails, the CVs the app made, the profile.
 */
export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/jobs", label: "Roles", icon: BriefcaseBusinessIcon },
  {
    href: "/applications",
    label: "Applications",
    shortLabel: "Applied",
    icon: InboxIcon,
  },
  { href: "/cvs", label: "CVs", notOnTabBar: true, icon: FileTextIcon },
  { href: "/profile", label: "Profile", icon: UserRoundIcon },
];

export const SETTINGS_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings2Icon },
];

/** Whether `href` is the page at `pathname`, or a page under it. */
export function isCurrent(href: NavHref, pathname: string | null): boolean {
  if (pathname === null) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
