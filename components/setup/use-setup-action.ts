"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";

import { callAction } from "@/lib/call-action";
import type { ActionResult, FieldErrors } from "@/lib/schemas/action";
import { setupKey } from "@/lib/setup/queries";

/** The first message in an action's errors, for one line under a button. */
export function firstError(errors: FieldErrors): string {
  return (
    errors.formErrors[0] ??
    Object.values(errors.fieldErrors)[0]?.[0] ??
    "Something went wrong. Try again."
  );
}

/**
 * Runs one of setup's Server Actions, then reads setup's state again, so the
 * page shows what was saved. `onDone` runs after a success, once the new
 * state is in.
 */
export function useSetupAction() {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await callAction(action);
      if (!result.ok) setError(firstError(result.errors));
      await queryClient.invalidateQueries({ queryKey: setupKey });
      if (result.ok) onDone?.();
    });
  }

  return { run, pending, error, clearError: () => setError(null) };
}
