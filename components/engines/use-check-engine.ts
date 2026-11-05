"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";

import { checkEngineAction } from "@/app/(app)/settings/actions";
import { callAction } from "@/lib/call-action";
import { engineCheckQuery, setupKey } from "@/lib/setup/queries";
import type { AgentEngine } from "@/lib/schemas/settings";

/**
 * Starts Check it works on an engine, then reads the check again wherever
 * it shows (setup and Settings), which follow it until it's done.
 */
export function useCheckEngine() {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start(engine: AgentEngine) {
    setError(null);
    startTransition(async () => {
      const result = await callAction(() => checkEngineAction({ engine }));
      if (!result.ok) {
        setError(
          result.errors.formErrors[0] ??
            Object.values(result.errors.fieldErrors)[0]?.[0] ??
            "Couldn't start the check.",
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: engineCheckQuery(engine).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: setupKey }),
      ]);
    });
  }

  return { start, pending, error, clearError: () => setError(null) };
}
