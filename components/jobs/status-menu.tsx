"use client";

import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { JobListRow } from "@/lib/dal/jobs";
import { JOB_STATUSES, type JobStatus } from "@/lib/schemas/tracker";
import { cn } from "@/lib/utils";

import { useSetStatus } from "./job-actions";
import { STATUS_GROUPS, STATUS_LABELS } from "./labels";
import { StatusPill } from "./status-pill";

function isJobStatus(value: unknown): value is JobStatus {
  return (JOB_STATUSES as readonly unknown[]).includes(value);
}

/**
 * A role's status as a pill that opens a menu to change it, for when the app
 * got it wrong. In a list it's smaller and names the role; at the top of a
 * role it's larger.
 */
export function StatusMenu({
  job,
  variant = "inline",
}: {
  job: Pick<JobListRow, "id" | "title" | "company" | "status">;
  variant?: "inline" | "pill";
}) {
  const setStatus = useSetStatus();
  const onValueChange = (value: unknown) => {
    if (isJobStatus(value)) setStatus(job, value);
  };
  const pill = variant === "pill";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={
          pill
            ? `Status: ${STATUS_LABELS[job.status]}. Change status`
            : `${job.title}: status ${STATUS_LABELS[job.status]}. Change status`
        }
      >
        <StatusPill
          status={job.status}
          className={cn(
            "hover:brightness-95 dark:hover:brightness-110",
            pill
              ? "h-7 gap-1.5 pr-2 pl-2.5 text-[0.8125rem]"
              : "h-6.5 pr-1.5 pl-2.5",
          )}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn("opacity-70", pill ? "size-3.5" : "size-3")}
          />
        </StatusPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {STATUS_GROUPS.map((group, index) => (
          <DropdownMenuGroup key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={job.status}
              onValueChange={onValueChange}
            >
              {group.statuses.map((status) => (
                <DropdownMenuRadioItem key={status} value={status} closeOnClick>
                  {STATUS_LABELS[status]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
