"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  deleteEmailAction,
  fileEmailAction,
  pasteEmailAction,
  retryEmailAction,
  setEmailHandledAction,
} from "@/app/(app)/applications/actions";
import { ActionError } from "@/components/jobs/use-job-actions";
import { callAction } from "@/lib/call-action";
import type { PastedEmailView } from "@/lib/dal/emails";
import { jobsKey } from "@/lib/jobs/queries";
import type { ActionResult } from "@/lib/schemas/action";
import type { PasteEmailInput } from "@/lib/schemas/mail";

// Writes to pasted emails. Each refetches the roles once it settles, and
// the action refreshes the page's server-rendered parts, so the emails, the
// role's status, its timeline and the Applications list all catch up.
// Failures show on the email itself, not in the role's save errors.

const emailsKey = ["emails"] as const;

async function run<T extends ActionResult>(
  action: () => Promise<T>,
): Promise<Extract<T, { ok: true }>> {
  const result = await callAction(action);
  if (!result.ok) throw new ActionError(result.errors);
  return result as Extract<T, { ok: true }>;
}

function useEmailMutation<TInput, TResult extends ActionResult>(
  kind: string,
  write: (input: TInput) => Promise<TResult>,
  optimistic?: (input: TInput) => (email: PastedEmailView) => PastedEmailView,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...emailsKey, kind],
    mutationFn: (input: TInput) => run(() => write(input)),
    onMutate: optimistic
      ? async (input) => {
          await queryClient.cancelQueries({ queryKey: jobsKey });
          const change = optimistic(input);
          const snapshot = queryClient.getQueriesData<PastedEmailView[]>({
            queryKey: jobsKey,
            predicate: (query) =>
              query.queryKey[1] === "emails" ||
              query.queryKey[1] === "pasted-emails",
          });
          for (const [key, emails] of snapshot) {
            if (emails) queryClient.setQueryData(key, emails.map(change));
          }
          return snapshot;
        }
      : undefined,
    onError: (_error, _input, snapshot) => {
      for (const [key, emails] of snapshot ?? [])
        queryClient.setQueryData(key, emails);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: jobsKey }),
  });
}

/** Pastes an email for Claude to read; the list polls until it's read. */
export function usePasteEmail() {
  return useEmailMutation("paste", (input: PasteEmailInput) =>
    pasteEmailAction(input),
  );
}

export function useRetryEmail() {
  return useEmailMutation(
    "retry",
    (emailId: string) => retryEmailAction({ emailId }),
    (emailId) => (email) =>
      email.id === emailId
        ? { ...email, status: "reading", error: null }
        : email,
  );
}

/** The reply copied or dealt with, or not after all. */
export function useEmailHandled() {
  return useEmailMutation(
    "handled",
    (input: { emailId: string; handled: boolean }) =>
      setEmailHandledAction(input),
    ({ emailId, handled }) =>
      (email) =>
        email.id === emailId
          ? { ...email, handledAt: handled ? new Date().toISOString() : null }
          : email,
  );
}

export function useDeleteEmail() {
  return useEmailMutation("delete", (emailId: string) =>
    deleteEmailAction({ emailId }),
  );
}

/** Files an email the app couldn't place under the picked role. */
export function useFileEmail() {
  return useEmailMutation("file", (input: { emailId: string; jobId: string }) =>
    fileEmailAction(input),
  );
}
