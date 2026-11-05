import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { CompanyTile } from "@/components/jobs/company-tile";
import { formatShortDay, formatWhere } from "@/components/jobs/labels";
import { ScoreRing } from "@/components/jobs/score-ring";
import { roleHref } from "@/lib/applications/progress";
import type { JobListRow } from "@/lib/dal/jobs";
import { nextStep } from "@/lib/jobs/next-step";
import { formatPostedAge } from "@/lib/jobs/posted";
import { cn } from "@/lib/utils";

// Rows of roles on the Overview. Each opens the role's page: its kit, or its
// application once applied to.

type State = { label: string; dot: string; text: string };

/** Where a picked role's kit stands. */
export function kitState(row: JobListRow, today: string): State {
  const step = nextStep(row, today);
  if (step?.kind === "tailoring") {
    return {
      label: "Writing the kit…",
      dot: "bg-neutral",
      text: "text-muted-foreground",
    };
  }
  if (step?.kind === "tailoring_failed") {
    return {
      label: "The kit didn't finish",
      dot: "bg-destructive",
      text: "text-destructive-ink",
    };
  }
  if (step?.kind === "answers") {
    return {
      label: `Ready, ${step.count === 1 ? "1 answer needs" : `${step.count} answers need`} you`,
      dot: "bg-warning",
      text: "text-warning-ink",
    };
  }
  if (row.status === "ready") {
    return {
      label: "Ready to send",
      dot: "bg-success",
      text: "text-success-ink",
    };
  }
  return {
    label: "Waiting to be written",
    dot: "bg-neutral",
    text: "text-muted-foreground",
  };
}

export function RoleRows({
  rows,
  today,
  state,
  label,
}: {
  rows: JobListRow[];
  today: string;
  /** The line under each role, such as where its kit stands. */
  state?: (row: JobListRow) => State;
  label: string;
}) {
  return (
    <ul aria-label={label} className="border-t">
      {rows.map((row) => {
        const line = state?.(row);
        const where = [
          row.company,
          row.postedOn ? formatPostedAge(row.postedOn, today) : null,
          row.deadline
            ? `apply by ${formatShortDay(row.deadline, today)}`
            : formatWhere(row.workplace, row.places),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={row.id} className="border-b last:border-b-0">
            <Link
              href={roleHref(row)}
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
                <span className="truncate text-[0.8125rem] text-muted-foreground">
                  {where}
                </span>
                {line ? (
                  <span
                    className={cn(
                      "mt-0.5 flex items-center gap-1.5 text-xs font-medium",
                      line.text,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", line.dot)}
                    />
                    {line.label}
                  </span>
                ) : null}
              </span>
              {row.score !== null ? (
                <ScoreRing score={row.score} size="sm" />
              ) : null}
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
