import type { JobStatus } from "@/lib/schemas/tracker";
import { cn } from "@/lib/utils";

import { STATUS_LABELS } from "./labels";

type Look = { pill: string; dot: string };

const PASSED: Look = {
  pill: "bg-neutral-soft text-muted-foreground",
  dot: "bg-neutral",
};

/** Each status's soft fill, text and dot, from the status colors in globals.css. */
const STATUS_LOOKS: Record<JobStatus, Look> = {
  new: { pill: "bg-primary-soft text-primary-ink", dot: "bg-primary" },
  shortlisted: {
    pill: "bg-status-shortlisted-soft text-status-shortlisted-ink",
    dot: "bg-status-shortlisted",
  },
  ready: {
    pill: "bg-status-ready-soft text-status-ready-ink",
    dot: "bg-status-ready",
  },
  applied: {
    pill: "bg-status-applied-soft text-status-applied-ink",
    dot: "bg-status-applied",
  },
  interviewing: {
    pill: "bg-status-interviewing-soft text-status-interviewing-ink",
    dot: "bg-status-interviewing",
  },
  offer: {
    pill: "bg-status-offer-soft text-status-offer-ink",
    dot: "bg-status-offer",
  },
  rejected: {
    pill: "bg-destructive-soft text-destructive-ink",
    dot: "bg-destructive",
  },
  no_response: PASSED,
  withdrawn: PASSED,
  skipped: PASSED,
  not_eligible: PASSED,
  listing_closed: PASSED,
  removed: PASSED,
};

/** The status's dot color, for the timeline. */
export function statusDot(status: JobStatus): string {
  return STATUS_LOOKS[status].dot;
}

/** A role's status as a colored pill with a dot. */
export function StatusPill({
  status,
  className,
  children,
}: {
  status: JobStatus;
  className?: string;
  /** After the label, such as the status menu's chevron. */
  children?: React.ReactNode;
}) {
  const look = STATUS_LOOKS[status];
  return (
    <span
      data-slot="status-pill"
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        look.pill,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", look.dot)} />
      {STATUS_LABELS[status]}
      {children}
    </span>
  );
}
