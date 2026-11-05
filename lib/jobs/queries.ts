// TanStack Query options for roles, one factory per query, so the server's
// prefetch and the browser's useQuery share the same key. In the browser they
// read the Route Handlers under /api; a Server Component that prefetches one
// swaps in its own queryFn, which reads lib/dal. Writes are Server Actions.
import { queryOptions } from "@tanstack/react-query";

import type { ApplyKit } from "@/lib/dal/apply-kit";
import type { FiledEmailView, PastedEmailView } from "@/lib/dal/emails";
import type { JobDetail } from "@/lib/dal/jobs";
import { isTailoringActive } from "@/lib/schemas/tailor";

import type { TopBarView } from "./top-bar";

/** Every roles query. Invalidating this refreshes kits, details and counts. */
export const jobsKey = ["jobs"] as const;

/** How often the apply kit checks on tailoring that's going. */
export const KIT_POLL_MS = 2000;

/** Polls every 2 seconds while Claude tailors the role, and not otherwise. */
export function kitPollInterval(kit: ApplyKit | undefined): number | false {
  return kit && isTailoringActive(kit.tailoring) ? KIT_POLL_MS : false;
}

/** How often pasted emails are checked on while Claude reads them. */
export const EMAIL_POLL_MS = 2000;

/** Polls every 2 seconds while an email is being read, and not otherwise. */
export function emailPollInterval(
  emails: readonly { status: PastedEmailView["status"] }[] | undefined,
): number | false {
  return emails?.some((email) => email.status === "reading")
    ? EMAIL_POLL_MS
    : false;
}

export type JobCounts = {
  /** Roles whose apply kit is ready to send. */
  readyToSend: number;
  /** Roles being worked on, from shortlisted to an offer. */
  inProgress: number;
  /** Applications whose company is waiting for the owner's reply. */
  yourTurn: number;
};

/** A Route Handler answered with an error. A 401 means the session ended. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

async function getJson<T>(url: string, failure: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new FetchError(failure, response.status);
  return response.json();
}

/** A role's score reasons, key facts and timeline. */
export function jobDetailQuery(id: string) {
  return queryOptions({
    queryKey: [...jobsKey, "detail", id] as const,
    queryFn: () =>
      getJson<JobDetail>(`/api/jobs/${id}`, "Couldn't load this role."),
  });
}

/** The nav's counts. */
export function jobCountsQuery() {
  return queryOptions({
    queryKey: [...jobsKey, "counts"] as const,
    queryFn: () =>
      getJson<JobCounts>("/api/jobs/counts", "Couldn't count the roles."),
  });
}

/** A role's apply kit, polled while Claude tailors it. */
export function applyKitQuery(id: string) {
  return queryOptions({
    queryKey: [...jobsKey, "kit", id] as const,
    queryFn: () =>
      getJson<ApplyKit>(`/api/jobs/${id}/kit`, "Couldn't load the apply kit."),
    refetchInterval: (query) => kitPollInterval(query.state.data),
  });
}

/** The emails pasted into one role, polled while Claude reads one. */
export function roleEmailsQuery(id: string) {
  return queryOptions({
    queryKey: [...jobsKey, "emails", id] as const,
    queryFn: () =>
      getJson<PastedEmailView[]>(
        `/api/jobs/${id}/emails`,
        "Couldn't load the emails.",
      ),
    refetchInterval: (query) => emailPollInterval(query.state.data),
  });
}

/**
 * The Applications page's pastes: being read, unplaced, or just filed.
 * Polled while Claude reads one.
 */
export function pastedEmailsQuery() {
  return queryOptions({
    queryKey: [...jobsKey, "pasted-emails"] as const,
    queryFn: () =>
      getJson<FiledEmailView[]>(
        "/api/emails",
        "Couldn't load the pasted emails.",
      ),
    refetchInterval: (query) => emailPollInterval(query.state.data),
  });
}

/** How often the top bar checks back while Claude works on something. */
export const WORK_POLL_MS = 5000;

/** Polls every 5 seconds while Claude is busy besides a search, and not otherwise. */
export function topBarPollInterval(
  view: TopBarView | undefined,
): number | false {
  return view?.working ? WORK_POLL_MS : false;
}

/** The top bar. Under jobsKey, so role and email writes refresh it too. */
export function topBarQuery() {
  return queryOptions({
    queryKey: [...jobsKey, "top-bar"] as const,
    queryFn: () =>
      getJson<TopBarView>("/api/top-bar", "Couldn't load the top bar."),
    refetchInterval: (query) => topBarPollInterval(query.state.data),
  });
}
