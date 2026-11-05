"use client";

import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { addCvSkillsAction } from "@/app/(app)/cvs/actions";
import {
  changeJobStatusAction,
  markAppliedAction,
  removeJobAction,
  restoreJobAction,
  saveKitAnswerAction,
  tailorJobAction,
} from "@/app/(app)/jobs/actions";
import { callAction } from "@/lib/call-action";
import type { ApplyKit } from "@/lib/dal/apply-kit";
import type { JobListRow } from "@/lib/dal/jobs";
import { adjustCounts, withStatus } from "@/lib/jobs/optimistic";
import {
  applyKitQuery,
  jobCountsQuery,
  jobDetailQuery,
  jobsKey,
} from "@/lib/jobs/queries";
import type { ActionResult, FieldErrors } from "@/lib/schemas/action";
import type { AddCvSkills } from "@/lib/schemas/cv-editor";
import type { SavedAnswer } from "@/lib/schemas/profile";
import type { MarkAppliedInput, TailorRequest } from "@/lib/schemas/tailor";
import type { JobRef, StatusChange } from "@/lib/schemas/tracker";

// Writes to a role. Each one shows on the role page and in the nav's counts
// straight away, rolls back if the server refuses it, and refetches the
// roles once it settles.

/** A Server Action's refusal, carried through TanStack Query as an error. */
export class ActionError extends Error {
  constructor(readonly errors: FieldErrors) {
    super(
      errors.formErrors[0] ??
        Object.values(errors.fieldErrors)[0]?.[0] ??
        "Couldn't save the change.",
    );
    this.name = "ActionError";
  }
}

async function run<T extends ActionResult>(
  action: () => Promise<T>,
): Promise<Extract<T, { ok: true }>> {
  const result = await callAction(action);
  if (!result.ok) throw new ActionError(result.errors);
  return result as Extract<T, { ok: true }>;
}

const getDetail = (queryClient: QueryClient, jobId: string) =>
  queryClient.getQueryData(jobDetailQuery(jobId).queryKey);
const getCounts = (queryClient: QueryClient) =>
  queryClient.getQueryData(jobCountsQuery().queryKey);

/** What one role's detail and the nav's counts held, to put back. */
type Snapshot = {
  jobId: string;
  detail: ReturnType<typeof getDetail>;
  counts: ReturnType<typeof getCounts>;
};

/**
 * Applies a change to one role's detail and the nav's counts. Returns what
 * they held before.
 */
function applyOptimistic(
  queryClient: QueryClient,
  jobId: string,
  change: <T extends JobListRow>(row: T) => T,
): Snapshot {
  const detail = getDetail(queryClient, jobId);
  const counts = getCounts(queryClient);
  if (detail) {
    queryClient.setQueryData(jobDetailQuery(jobId).queryKey, change(detail));
    if (counts) {
      queryClient.setQueryData(
        jobCountsQuery().queryKey,
        adjustCounts(counts, detail, change(detail)),
      );
    }
  }
  return { jobId, detail, counts };
}

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  if (!snapshot) return;
  queryClient.setQueryData(
    jobDetailQuery(snapshot.jobId).queryKey,
    snapshot.detail,
  );
  queryClient.setQueryData(jobCountsQuery().queryKey, snapshot.counts);
}

/**
 * While another write is still going, a refetch could bring back what it
 * optimistically changed, so only the last write to settle refetches.
 */
function settle(queryClient: QueryClient) {
  return queryClient.isMutating({ mutationKey: jobsKey }) === 1
    ? queryClient.invalidateQueries({ queryKey: jobsKey })
    : undefined;
}

function useJobMutation<
  TInput extends { jobId: string },
  TResult extends ActionResult,
>(
  kind: string,
  write: (input: TInput) => Promise<TResult>,
  change: (input: TInput) => <T extends JobListRow>(row: T) => T,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...jobsKey, kind],
    mutationFn: (input: TInput) => run(() => write(input)),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: jobsKey });
      return applyOptimistic(queryClient, input.jobId, change(input));
    },
    onError: (_error, _input, snapshot) => restore(queryClient, snapshot),
    onSettled: () => settle(queryClient),
  });
}

/** A new status from the role page: Prepare kit, Applied and the rest. */
export function useChangeStatus() {
  return useJobMutation(
    "status",
    (input: StatusChange) => changeJobStatusAction(input),
    (input) => withStatus(input.status),
  );
}

/** Remove: the role shows as Removed straight away. */
export function useRemoveJob() {
  return useJobMutation(
    "remove",
    (input: JobRef) => removeJobAction(input),
    () => withStatus("removed"),
  );
}

/** Restore: the server knows where the role goes back to. */
export function useRestoreJob() {
  return useJobMutation(
    "restore",
    (input: JobRef) => restoreJobAction(input),
    () =>
      <T extends JobListRow>(row: T): T =>
        row,
  );
}

/**
 * Tailor or regenerate. The kit shows the request as queued straight away
 * and starts polling; the server's state replaces it on the next fetch.
 */
export function useTailor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...jobsKey, "tailor"],
    mutationFn: (input: TailorRequest) => run(() => tailorJobAction(input)),
    onSuccess: ({ requestId }, input) => {
      queryClient.setQueryData(
        applyKitQuery(input.jobId).queryKey,
        (kit): ApplyKit | undefined =>
          kit && {
            ...kit,
            tailoring: {
              requestId,
              kinds: input.kinds,
              note: input.note || null,
              status: "queued",
              stage: "queued",
              error: null,
              requestedAt: new Date().toISOString(),
              finishedAt: null,
            },
          },
      );
    },
    onSettled: (_data, _error, input) =>
      queryClient.invalidateQueries({
        queryKey: applyKitQuery(input.jobId).queryKey,
      }),
  });
}

/** Mark as applied, then refresh the kit, the top bar and the counts. */
export function useMarkApplied() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...jobsKey, "applied"],
    mutationFn: (input: MarkAppliedInput) =>
      run(() => markAppliedAction(input)),
    onSuccess: ({ application }, input) => {
      queryClient.setQueryData(
        applyKitQuery(input.jobId).queryKey,
        (kit): ApplyKit | undefined =>
          kit && {
            ...kit,
            application,
            job: { ...kit.job, status: "applied" },
          },
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: jobsKey }),
  });
}

/**
 * An answer the owner gives in the apply kit. It's saved to their standard
 * answers, and the kit refetches to show it in place.
 */
export function useSaveKitAnswer(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...jobsKey, "answer"],
    mutationFn: (input: SavedAnswer) => run(() => saveKitAnswerAction(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: applyKitQuery(jobId).queryKey,
      }),
  });
}

/**
 * Adds profile skills to the kit's CV, from its ATS keywords. The kit
 * refetches and follows the new version while its PDF is drawn.
 */
export function useAddCvSkills(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...jobsKey, "cv-skills"],
    mutationFn: (input: AddCvSkills) => run(() => addCvSkillsAction(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: applyKitQuery(jobId).queryKey,
      }),
  });
}
