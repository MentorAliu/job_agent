import { cn } from "@/lib/utils";

import { formatBudget, formatCost } from "./run-labels";

/** This month's spend as a bar that turns amber near the budget and red at it. */
export function BudgetMeter({
  spentUsd,
  limitUsd,
  className,
}: {
  spentUsd: number;
  limitUsd: number;
  className?: string;
}) {
  const share = limitUsd > 0 ? Math.min(1, spentUsd / limitUsd) : 1;
  return (
    <div
      role="progressbar"
      aria-label="Share of the monthly budget spent"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={`${formatCost(spentUsd)} of ${formatBudget(limitUsd)}`}
      className={cn("h-1.5 overflow-hidden rounded-full bg-track", className)}
    >
      <div
        className={cn(
          "h-full rounded-full",
          share >= 1
            ? "bg-destructive"
            : share >= 0.8
              ? "bg-warning"
              : "bg-primary",
        )}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  );
}
