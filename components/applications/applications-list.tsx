import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import Form from "next/form";
import Link from "next/link";

import { emailLabel } from "@/components/emails/labels";
import { CompanyTile } from "@/components/jobs/company-tile";
import { RelativeDate } from "@/components/jobs/relative-date";
import { StatusPill } from "@/components/jobs/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  APPLICATION_STAGES,
  APPLIED_WITHIN,
  serializeApplicationsParams,
  type ApplicationsParams,
  type ApplicationStage,
} from "@/lib/applications/params";
import type { ApplicationRow, ApplicationsPage } from "@/lib/dal/applications";
import { cn } from "@/lib/utils";

// The Applications page's list: every role applied to, filtered by whose
// move it is, newest activity first. Each row opens the application's own
// page, with its emails.

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  all: "All",
  your_turn: "Your turn",
  waiting: "Waiting on them",
  interviewing: "Interviewing",
  offer: "Offers",
  closed: "Closed",
};

const EMPTY: Record<ApplicationStage, string> = {
  all: "No applications yet. Once you send a kit and mark it applied, it shows here.",
  your_turn: "Nothing to answer. When a company writes, paste the email above.",
  waiting: "No applications waiting on a company.",
  interviewing: "No interviews yet.",
  offer: "No offers yet.",
  closed: "Nothing closed.",
};

const WITHIN_LABELS: Record<(typeof APPLIED_WITHIN)[number], string> = {
  7: "Past week",
  30: "Past month",
  90: "Past 3 months",
};

const href = (params: ApplicationsParams) =>
  serializeApplicationsParams("/applications", params);

function Stages({
  view,
  page,
}: {
  view: ApplicationsParams;
  page: ApplicationsPage;
}) {
  return (
    <nav
      aria-label="Applications by stage"
      className="-mx-4 overflow-x-auto px-4"
    >
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1">
        {APPLICATION_STAGES.map((stage) => {
          const current = stage === view.stage;
          const count = page.stages[stage];
          const urgent = stage === "your_turn" && count > 0;
          return (
            <li key={stage}>
              <Link
                href={href({ ...view, stage, page: 0 })}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  current && "bg-background text-foreground shadow-xs",
                )}
              >
                {STAGE_LABELS[stage]}
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    urgent
                      ? "rounded-full bg-warning-soft px-1.5 font-semibold text-warning-ink"
                      : "opacity-70",
                  )}
                >
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Search by company or title, and how far back to look. */
function Filters({ view }: { view: ApplicationsParams }) {
  const within = [null, ...APPLIED_WITHIN] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Form
        action="/applications"
        className="flex w-full max-w-xs items-center gap-1.5"
      >
        {view.stage !== "all" ? (
          <input type="hidden" name="stage" value={view.stage} />
        ) : null}
        {view.within !== null ? (
          <input type="hidden" name="within" value={view.within} />
        ) : null}
        <label htmlFor="applications-search" className="sr-only">
          Search by company or role
        </label>
        <Input
          id="applications-search"
          name="q"
          type="search"
          defaultValue={view.q}
          placeholder="Company or role"
          maxLength={100}
        />
        <Button type="submit" variant="outline" size="icon">
          <SearchIcon aria-hidden />
          <span className="sr-only">Search</span>
        </Button>
      </Form>
      <nav
        aria-label="Applied within"
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        <span className="mr-1 text-muted-foreground">Applied:</span>
        {within.map((days) => {
          const current = view.within === days;
          return (
            <Link
              key={days ?? "any"}
              href={href({ ...view, within: days, page: 0 })}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                current && "bg-muted font-medium text-foreground",
              )}
            >
              {days === null ? "Any time" : WITHIN_LABELS[days]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** The line under a row: the latest email, or how long it's been. */
function Latest({ row }: { row: ApplicationRow }) {
  const email = row.latestEmail;
  if (!email) {
    return (
      <span className="truncate text-[0.8125rem] text-muted-foreground">
        {row.company} · no email yet
      </span>
    );
  }
  return (
    <span className="truncate text-[0.8125rem] text-muted-foreground">
      {row.company} ·{" "}
      <span className="font-medium text-foreground">{emailLabel(email)}</span>
      {email.summary ? `: ${email.summary}` : null}
    </span>
  );
}

function Pages({
  view,
  page,
}: {
  view: ApplicationsParams;
  page: ApplicationsPage;
}) {
  const pages = Math.ceil(page.stages[view.stage] / page.size);
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

/** Applications as rows, for this page and the Overview. */
export function ApplicationRows({
  rows,
  label,
  className,
  markTurn = true,
}: {
  rows: ApplicationRow[];
  label: string;
  className?: string;
  /** Say "Your turn" on the rows where it is, in place of the date. */
  markTurn?: boolean;
}) {
  return (
    <ul aria-label={label} className={className}>
      {rows.map((row) => (
        <li key={row.id} className="border-b last:border-b-0">
          <Link
            href={`/applications/${row.id}`}
            className="group flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
          >
            <CompanyTile
              company={row.company}
              className="size-9 rounded-lg text-sm"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold group-hover:underline">
                {row.title}
              </span>
              <Latest row={row} />
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill status={row.status} />
              {markTurn && row.yourTurn ? (
                <span className="text-xs font-semibold text-warning-ink">
                  Your turn
                </span>
              ) : row.lastActivityAt ? (
                <RelativeDate
                  iso={row.lastActivityAt}
                  kind="day"
                  className="text-xs text-muted-foreground tabular-nums"
                />
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ApplicationsList({
  view,
  page,
}: {
  view: ApplicationsParams;
  page: ApplicationsPage;
}) {
  const filtered = view.q !== "" || view.within !== null;
  return (
    <div className="flex flex-col gap-4">
      <Stages view={view} page={page} />
      <Filters view={view} />
      {page.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {filtered
            ? "No applications match. Clear the search or pick another date."
            : EMPTY[view.stage]}
        </p>
      ) : (
        <ApplicationRows
          rows={page.rows}
          label={STAGE_LABELS[view.stage]}
          className="overflow-hidden rounded-xl border bg-card shadow-xs"
        />
      )}
      <Pages view={view} page={page} />
    </div>
  );
}
