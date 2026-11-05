"use client";

import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isApplied } from "@/lib/applications/progress";
import type { JobListRow } from "@/lib/dal/jobs";
import { cn } from "@/lib/utils";

import { useRemoveJob, useRestoreJob } from "./use-job-actions";

/**
 * Remove takes a role off the lists, into the Removed tab; once removed,
 * Restore puts it back where it was. Roles applied to have neither: they
 * live in Applications. In a list row it's a small button; at the top of a
 * role it says what it does.
 */
export function RemoveRole({
  job,
  variant,
  className,
}: {
  job: Pick<JobListRow, "id" | "title" | "status">;
  variant: "row" | "header";
  className?: string;
}) {
  const remove = useRemoveJob();
  const restore = useRestoreJob();
  const busy = remove.isPending || restore.isPending;
  const error = remove.error?.message ?? restore.error?.message;
  const row = variant === "row";

  if (isApplied(job.status)) return null;
  const removed = job.status === "removed";
  const label = removed ? "Restore" : "Remove";
  const hint = removed
    ? "Put it back where it was"
    : "Take it off your lists. The Removed tab keeps it, and searches won't bring it back.";
  const Icon = removed ? ArchiveRestoreIcon : Trash2Icon;

  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <Button
        variant={row ? "ghost" : "outline"}
        size={row && !removed ? "icon-sm" : "sm"}
        title={hint}
        aria-label={row ? `${label} ${job.title}` : undefined}
        disabled={busy}
        onClick={() => (removed ? restore : remove).mutate({ jobId: job.id })}
        className={cn(row && "text-muted-foreground hover:text-foreground")}
      >
        {busy ? (
          <Spinner aria-hidden data-icon="inline-start" />
        ) : (
          <Icon aria-hidden data-icon="inline-start" />
        )}
        {row && !removed ? null : label}
      </Button>
    </span>
  );
}
