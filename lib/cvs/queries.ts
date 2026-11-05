// TanStack Query options for the CVs page and each built CV. The pages
// prefetch them on the server and follow them in the browser while a CV is
// being written or drawn.
import { queryOptions } from "@tanstack/react-query";

import type { BuiltCvDetail, CvList } from "@/lib/dal/cvs";
import { FetchError } from "@/lib/jobs/queries";
import { isBuildActive } from "@/lib/schemas/cv-builder";

/** How often a CV's page checks on a CV being written. */
export const CV_POLL_MS = 2000;

/** Polls every 2 seconds while the CV is being built, and not otherwise. */
export function cvPollInterval(cv: BuiltCvDetail | undefined): number | false {
  return cv && isBuildActive(cv) ? CV_POLL_MS : false;
}

export function builtCvQuery(id: string) {
  return queryOptions({
    queryKey: ["cvs", id] as const,
    queryFn: async (): Promise<BuiltCvDetail> => {
      const response = await fetch(`/api/cvs/${id}`);
      if (!response.ok) {
        throw new FetchError("Couldn't check on the CV.", response.status);
      }
      return response.json();
    },
    refetchInterval: (query) => cvPollInterval(query.state.data),
  });
}

/** The CVs page's cards, followed while a CV on it is being made. */
export function cvListQuery() {
  return queryOptions({
    queryKey: ["cvs"] as const,
    queryFn: async (): Promise<CvList> => {
      const response = await fetch("/api/cvs");
      if (!response.ok) {
        throw new FetchError("Couldn't load the CVs.", response.status);
      }
      return response.json();
    },
    refetchInterval: (query) =>
      query.state.data?.built.some((cv) => isBuildActive(cv))
        ? CV_POLL_MS
        : false,
  });
}
