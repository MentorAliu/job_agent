import {
  defaultShouldDehydrateQuery,
  environmentManager,
  QueryClient,
} from "@tanstack/react-query";

// Set up as in TanStack Query's "Advanced Server Rendering" guide: a new
// client per request on the server, one shared client in the browser.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000 },
      dehydrate: {
        // Pending queries are dehydrated too, so prefetches can stream.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
        // Next.js redacts server errors itself, and needs its own errors
        // (such as the ones that mark a page dynamic) to pass through as
        // they are.
        shouldRedactErrors: () => false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
