// TanStack Query options for the files the in-app viewer shows. Each URL
// names one stored file that never changes (a new version of a document gets
// a new id), so a file is fetched once and opens at once the next time.
import { queryOptions } from "@tanstack/react-query";

import { FetchError } from "@/lib/jobs/queries";

/** A stored PDF's bytes. */
export function pdfFileQuery(url: string) {
  return queryOptions({
    queryKey: ["pdf-file", url] as const,
    queryFn: async ({ signal }): Promise<Uint8Array<ArrayBuffer>> => {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new FetchError("Couldn't load the PDF.", response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    staleTime: Infinity,
    // A missing file or an ended session won't change on a retry.
    retry: (failures, error) =>
      !(error instanceof FetchError && error.status < 500) && failures < 3,
  });
}
