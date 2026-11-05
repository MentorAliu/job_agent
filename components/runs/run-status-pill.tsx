import type { RunStatus } from "@/lib/schemas/job";
import { cn } from "@/lib/utils";

import { STATUS_LABELS } from "./run-labels";

const RUN_LOOKS: Record<RunStatus, { pill: string; dot: string }> = {
  running: {
    pill: "bg-primary-soft text-primary-ink",
    dot: "animate-pulse bg-primary",
  },
  succeeded: { pill: "bg-success-soft text-success-ink", dot: "bg-success" },
  stopped: { pill: "bg-warning-soft text-warning-ink", dot: "bg-warning" },
  failed: {
    pill: "bg-destructive-soft text-destructive-ink",
    dot: "bg-destructive",
  },
};

/** A search run's status as a colored pill with a dot. */
export function RunStatusPill({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const look = RUN_LOOKS[status];
  return (
    <span
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        look.pill,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", look.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}
