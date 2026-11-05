"use client";

import { CheckIcon } from "lucide-react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** The form's Save button, kept in view at the bottom of long forms. */
export function SaveBar<T extends FieldValues>({
  form,
  savedAt,
  label = "Save",
}: {
  form: UseFormReturn<T>;
  savedAt: Date | null;
  label?: string;
}) {
  const { isDirty, isSubmitting, submitCount, errors } = form.formState;
  const serverError = errors.root?.server?.message;
  const hasFieldErrors = Object.keys(errors).some((key) => key !== "root");

  let status: React.ReactNode = null;
  if (serverError) {
    status = <span className="text-destructive">{serverError}</span>;
  } else if (submitCount > 0 && hasFieldErrors) {
    status = (
      <span className="text-destructive">
        Some fields need fixing. They&apos;re marked in red.
      </span>
    );
  } else if (isDirty) {
    status = <span className="text-muted-foreground">Unsaved changes</span>;
  } else if (savedAt) {
    status = (
      <span className="flex items-center gap-1.5 text-success-ink">
        <CheckIcon aria-hidden className="size-4" />
        <span>
          Saved at{" "}
          {savedAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </span>
    );
  }

  return (
    <div className="sticky bottom-(--tab-bar-height) z-10 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Spinner aria-hidden data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  );
}
