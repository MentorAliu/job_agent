import Link from "next/link";

import { BudgetMeter } from "@/components/runs/budget-meter";
import {
  formatBudget,
  formatCost,
  shortDay,
} from "@/components/runs/run-labels";
import type { OverviewStats } from "@/lib/dal/overview";
import type { MonthActivity } from "@/lib/dal/spend";

// The four numbers at the top of the Overview. Each one opens the list or
// page behind it.

function Kpi({
  label,
  value,
  detail,
  href,
  children,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
    >
      <span className="text-[0.8125rem] font-medium text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {value}
      </span>
      <span className="truncate text-[0.8125rem] text-muted-foreground">
        {detail}
      </span>
      {children}
    </Link>
  );
}

/** "3 more than last month", "2 fewer than last month", "Same as last month" */
function comparedWithLastMonth(now: number, before: number): string {
  if (now === before) return "Same as last month";
  const difference = Math.abs(now - before);
  return `${difference} ${now > before ? "more" : "fewer"} than last month`;
}

/** "Prezly and Ramp", "Prezly, Ramp and 2 more" */
function companyList(companies: string[]): string {
  const unique = [...new Set(companies)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}

export function OverviewKpis({
  stats,
  activity,
}: {
  stats: OverviewStats;
  activity: MonthActivity;
}) {
  const limit = activity.limits.monthlyUsd;
  const replyRate =
    stats.sentTotal > 0
      ? `${Math.round((stats.replied / stats.sentTotal) * 100)}%`
      : "–";
  return (
    <section
      aria-label="Key numbers"
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <Kpi
        label="Sent this month"
        value={String(stats.sentThisMonth)}
        detail={comparedWithLastMonth(stats.sentThisMonth, stats.sentLastMonth)}
        href="/applications"
      />
      <Kpi
        label="Reply rate"
        value={replyRate}
        detail={
          stats.sentTotal > 0
            ? `${stats.replied} of ${stats.sentTotal} answered`
            : "Nothing sent yet"
        }
        href="/applications"
      />
      <Kpi
        label="Interviews"
        value={String(stats.interviews.count)}
        detail={
          stats.interviews.count > 0
            ? companyList(stats.interviews.companies)
            : "None yet"
        }
        href="/applications?stage=interviewing"
      />
      <Kpi
        label="Spent this month"
        value={formatCost(activity.spentUsd)}
        detail={`of ${formatBudget(limit)}, resets ${shortDay(activity.nextMonthStart)}`}
        href="/runs"
      >
        <BudgetMeter
          spentUsd={activity.spentUsd}
          limitUsd={limit}
          className="mt-1.5"
        />
      </Kpi>
    </section>
  );
}
