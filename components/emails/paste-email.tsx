"use client";

import { MailPlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PASTE_MAX_CHARS } from "@/lib/schemas/mail";

import { ActionError } from "@/components/jobs/use-job-actions";

import { usePasteEmail } from "./use-email-actions";

// The one place to type in for emails: paste what the company sent, and
// Claude reads it in the background.

export function PasteEmail({
  jobId,
  label,
  hint,
  onPasted,
}: {
  /** The role it's pasted into, or null for the app to find it. */
  jobId: string | null;
  label: string;
  hint: string;
  onPasted?: (emailId: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const paste = usePasteEmail();
  const error =
    paste.error instanceof ActionError
      ? (paste.error.errors.fieldErrors.text?.[0] ?? paste.error.message)
      : paste.error?.message;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        paste.mutate(
          { jobId, text },
          {
            onSuccess: ({ emailId }) => {
              setText("");
              onPasted?.(emailId);
            },
          },
        );
      }}
    >
      <label htmlFor={`${id}-text`} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={`${id}-text`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste the whole email here, with its subject and signature if you can."
        maxLength={PASTE_MAX_CHARS}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        className="max-h-72 min-h-24"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="submit"
          disabled={paste.isPending || text.trim().length === 0}
        >
          <MailPlusIcon aria-hidden data-icon="inline-start" />
          {paste.isPending ? "Adding…" : "Read email"}
        </Button>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </form>
  );
}
