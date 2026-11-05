"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { topBarQuery } from "@/lib/jobs/queries";

/**
 * Tells the server the owner has the Roles page open, once it's on screen
 * (a prefetch doesn't count), then refreshes the top bar if it still counts
 * new roles, so the count clears. Renders nothing.
 */
export function MarkRolesSeen() {
  const queryClient = useQueryClient();
  useEffect(() => {
    fetch("/api/jobs/seen", { method: "POST" })
      .then((response) => {
        const { queryKey } = topBarQuery();
        const bar = queryClient.getQueryData(queryKey);
        if (response.ok && bar && bar.newRoles > 0) {
          return queryClient.invalidateQueries({ queryKey });
        }
      })
      // Nothing to show: the next visit tries again.
      .catch(() => {});
  }, [queryClient]);
  return null;
}
