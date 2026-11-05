import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { roleHref } from "@/lib/applications/progress";
import type { JobListPage } from "@/lib/dal/jobs";
import { AUTO_PICK_MIN_SCORE } from "@/lib/jobs/auto-pick";
import {
  ROLE_FILTERS,
  serializeRolesParams,
  tabSorts,
  viewSort,
  type RoleFilter,
  type RoleSort,
  type RolesParams,
} from "@/lib/jobs/list-params";
import { isNewRole } from "@/lib/jobs/new-roles";
import { formatPostedAge } from "@/lib/jobs/posted";
import { ROLE_TABS, tabCount, type RoleTab } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";

import { CompanyTile } from "./company-tile";
import { formatSalaryShort, formatWhere } from "./labels";
import { RelativeDate } from "./relative-date";
import { RemoveRole } from "./remove-role";
import { ScoreRing } from "./score-ring";
import { StatusPill } from "./status-pill";

// The Roles page: every role in tabs by where it stands, to read, with
// quick filters and an order. Each row opens the role's page.

export const TAB_LABELS: Record<RoleTab, string> = {
  to_send: "To send",
  waiting: "Waiting",
  passed: "Passed over",
  all: "All",
  removed: "Removed",
};

const EMPTY: Record<RoleTab, string> = {
  to_send:
    "No kits right now. After each search the app picks the strong matches and writes their kits.",
  waiting: "Nothing is waiting for a kit.",
  passed: "Nothing passed over yet.",
  all: "No roles yet. The first search fills this page.",
  removed: "Nothing removed.",
};

const FILTER_LABELS: Record<RoleFilter, string> = {
  new: "New",
  strong: `Score ${AUTO_PICK_MIN_SCORE}+`,
  salary: "Salary listed",
};

const FILTER_HINTS: Record<RoleFilter, string> = {
  new: "Found since your last visit to this page",
  strong: `Scored ${AUTO_PICK_MIN_SCORE} or more, the score the app picks roles at`,
  salary: "The posting gives a salary",
};

export const SORT_LABELS: Record<RoleSort, string> = {
  ready: "Ready first",
  next: "Next for a kit",
  best: "Best match",
  newest: "Newest",
};

const href = (params: RolesParams) => serializeRolesParams("/jobs", params);

/** Tabs that only show while they have roles, or are open. */
const SOMETIMES: readonly RoleTab[] = ["waiting", "removed"];

function Tabs({ view, page }: { view: RolesParams; page: JobListPage }) {
  const tabs = ROLE_TABS.filter(
    (tab) =>
      !SOMETIMES.includes(tab) ||
      view.tab === tab ||
      tabCount(page.statuses, tab) > 0,
  );
  return (
    <nav aria-label="Roles by stage" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1">
        {tabs.map((tab) => {
          const current = tab === view.tab;
          return (
            <li key={tab}>
              {/* The filters carry over; each tab has its own order. */}
              <Link
                href={href({ ...view, tab, sort: null, page: 0 })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  current && "bg-background text-foreground shadow-xs",
                )}
              >
                {TAB_LABELS[tab]}
                <span className="text-xs tabular-nums opacity-70">
                  {tabCount(page.statuses, tab)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const CHIP =
  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[0.8125rem] font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** One quick filter, on or off. New also says how many roles are new. */
function FilterChip({
  view,
  filter,
  count,
}: {
  view: RolesParams;
  filter: RoleFilter;
  count?: number;
}) {
  const on = view.only.includes(filter);
  const only = on
    ? view.only.filter((item) => item !== filter)
    : ROLE_FILTERS.filter(
        (item) => item === filter || view.only.includes(item),
      );
  return (
    <Link
      href={href({ ...view, only, page: 0 })}
      title={FILTER_HINTS[filter]}
      className={cn(
        CHIP,
        on
          ? "border-primary/40 bg-primary-soft text-primary-ink"
          : "bg-card text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      {on ? (
        <CheckIcon aria-hidden className="size-3.5" />
      ) : filter === "new" ? (
        <SparklesIcon aria-hidden className="size-3.5 text-primary" />
      ) : null}
      {FILTER_LABELS[filter]}
      {count !== undefined && count > 0 ? (
        <span
          className={cn(
            "rounded-full px-1.5 text-[0.6875rem] leading-4.5 font-semibold tabular-nums",
            on
              ? "bg-primary text-primary-foreground"
              : "bg-primary-soft text-primary-ink",
          )}
        >
          {count}
        </span>
      ) : null}
      <span className="sr-only">
        {`. ${FILTER_HINTS[filter]}.`}
        {on ? " On." : ""}
      </span>
    </Link>
  );
}

/** The quick filters, and the order. */
function Filters({ view, page }: { view: RolesParams; page: JobListPage }) {
  const sorts = tabSorts(view.tab);
  const sort = viewSort(view);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <div
        role="group"
        aria-label="Show only"
        className="flex flex-wrap items-center gap-1.5"
      >
        <FilterChip
          view={view}
          filter="new"
          count={tabCount(page.statuses, view.tab, "fresh")}
        />
        <FilterChip view={view} filter="strong" />
        <FilterChip view={view} filter="salary" />
      </div>
      <nav
        aria-label="Order"
        className="flex flex-wrap items-center gap-1 text-sm sm:ml-auto"
      >
        <span className="mr-1 text-muted-foreground">Sort:</span>
        {sorts.map((option) => {
          const current = option === sort;
          return (
            <Link
              key={option}
              href={href({
                ...view,
                // The tab's own order needs nothing in the URL.
                sort: option === sorts[0] ? null : option,
                page: 0,
              })}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-0.5 whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                current && "bg-muted font-medium text-foreground",
              )}
            >
              {SORT_LABELS[option]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Pages({ view, page }: { view: RolesParams; page: JobListPage }) {
  const pages = Math.ceil(page.total / page.size);
  if (pages <= 1) return null;
  const link = (to: number, label: string, icon: React.ReactNode) =>
    to < 0 || to >= pages ? (
      <span
        aria-disabled
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "pointer-events-none opacity-50",
        )}
      >
        {icon}
        {label}
      </span>
    ) : (
      <Link
        href={href({ ...view, page: to })}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {icon}
        {label}
      </Link>
    );
  return (
    <nav
      aria-label="Pages"
      className="flex items-center justify-between gap-3 text-sm"
    >
      {link(
        view.page - 1,
        "Previous",
        <ChevronLeftIcon aria-hidden data-icon="inline-start" />,
      )}
      <span className="text-muted-foreground tabular-nums">
        Page {view.page + 1} of {pages}
      </span>
      {link(
        view.page + 1,
        "Next",
        <ChevronRightIcon aria-hidden data-icon="inline-end" />,
      )}
    </nav>
  );
}

/** What an empty list says, with a way back when filters emptied it. */
function Empty({ view }: { view: RolesParams }) {
  if (view.only.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        {EMPTY[view.tab]}
      </p>
    );
  }
  const onlyNew = view.only.length === 1 && view.only[0] === "new";
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
      <p>
        {onlyNew
          ? "Nothing new here since your last visit. The next search brings more."
          : "No roles match these filters."}
      </p>
      <Link
        href={href({ ...view, only: [], page: 0 })}
        className="rounded-sm font-semibold text-primary-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Clear the filters
      </Link>
    </div>
  );
}

export function RolesList({
  view,
  page,
  newSince,
}: {
  view: RolesParams;
  page: JobListPage;
  /** Roles found after this (ISO) are New. */
  newSince: string;
}) {
  // With the New filter on, every row is new, so none needs the badge.
  const since = view.only.includes("new") ? null : new Date(newSince);
  const { today } = page;
  return (
    <div className="flex flex-col gap-4">
      <Tabs view={view} page={page} />
      <Filters view={view} page={page} />
      {page.rows.length === 0 ? (
        <Empty view={view} />
      ) : (
        <ul
          aria-label={TAB_LABELS[view.tab]}
          className="overflow-hidden rounded-xl border bg-card shadow-xs"
        >
          {page.rows.map((row) => {
            const fresh = isNewRole(row.foundAt, since);
            const where = [
              row.company,
              row.postedOn ? formatPostedAge(row.postedOn, today) : null,
              formatWhere(row.workplace, row.places),
              row.salary ? formatSalaryShort(row.salary) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={row.id}
                className="flex items-center border-b pr-2 last:border-b-0 has-[a:hover]:bg-muted/50 sm:pr-3"
              >
                <Link
                  href={roleHref(row)}
                  className="group flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-4 outline-none focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:pl-5"
                >
                  <CompanyTile
                    company={row.company}
                    className="size-9 rounded-lg text-sm"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold group-hover:underline">
                        {row.title}
                      </span>
                      {fresh ? (
                        <span className="shrink-0 rounded-full bg-primary px-1.5 text-[0.6875rem] leading-4.5 font-semibold text-primary-foreground">
                          New
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-[0.8125rem] text-muted-foreground">
                      {where}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill status={row.status} />
                    <RelativeDate
                      iso={row.appliedAt ?? row.statusAt}
                      kind="day"
                      className="text-xs text-muted-foreground tabular-nums"
                    />
                  </span>
                  {row.score !== null ? (
                    <ScoreRing
                      score={row.score}
                      size="sm"
                      className="max-sm:hidden"
                    />
                  ) : (
                    <span aria-hidden className="size-8 max-sm:hidden" />
                  )}
                </Link>
                <RemoveRole job={row} variant="row" />
              </li>
            );
          })}
        </ul>
      )}
      <Pages view={view} page={page} />
    </div>
  );
}
