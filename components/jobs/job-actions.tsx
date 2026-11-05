"use client";

import { useMutationState } from "@tanstack/react-query";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { JobListRow } from "@/lib/dal/jobs";
import { jobsKey } from "@/lib/jobs/queries";
import type { JobStatus } from "@/lib/schemas/tracker";

import { useChangeStatus } from "./use-job-actions";

type JobRef = Pick<JobListRow, "id" | "status">;

/** Moves a role to another status straight away. No reason is asked for. */
export function useSetStatus() {
  const changeStatus = useChangeStatus();
  return (job: JobRef, status: JobStatus) => {
    if (status === job.status) return;
    changeStatus.mutate({ jobId: job.id, status, reason: "" });
  };
}

/**
 * Says when a change to a role couldn't be saved. The change has already
 * been rolled back on screen by then.
 */
export function JobSaveErrors() {
  const failures = useMutationState({
    filters: { mutationKey: jobsKey, status: "error" },
    select: (mutation) => ({
      at: mutation.state.submittedAt,
      message:
        mutation.state.error instanceof Error
          ? mutation.state.error.message
          : "Couldn't save the change.",
    }),
  });
  const [dismissedAt, setDismissedAt] = useState(0);
  const latest = failures.filter((failure) => failure.at > dismissedAt).at(-1);
  if (!latest) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 w-full max-w-sm">
      <Alert variant="destructive" className="bg-background shadow-lg">
        <CircleAlertIcon />
        <AlertTitle>Your change wasn&apos;t saved</AlertTitle>
        <AlertDescription>
          {latest.message} The role is back as it was.
        </AlertDescription>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          onClick={() => setDismissedAt(latest.at)}
        >
          <XIcon aria-hidden />
          <span className="sr-only">Dismiss</span>
        </Button>
      </Alert>
    </div>
  );
}
