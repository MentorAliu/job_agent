"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { pastedEmailsQuery } from "@/lib/jobs/queries";

import { EmailCard } from "./email-card";
import { PasteEmail } from "./paste-email";
import { useOnEmailsRead } from "./role-emails";
import { useFileEmail } from "./use-email-actions";

type Choice = { id: string; title: string; company: string };

/** For an email the app couldn't place: pick its application. */
function FileUnder({
  emailId,
  failed,
  choices,
}: {
  emailId: string;
  /** Its read failed, rather than finding no application. */
  failed: boolean;
  choices: Choice[];
}) {
  const id = useId();
  const [jobId, setJobId] = useState("");
  const file = useFileEmail();
  if (choices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no applications to file it under yet.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (jobId) file.mutate({ emailId, jobId });
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {failed
          ? "Or pick the application it's about, and Claude reads it with that role in mind."
          : "The app couldn't tell which application this is about. Pick it, and Claude reads the email again with that role in mind."}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={id}
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          className="w-full max-w-sm"
        >
          <NativeSelectOption value="">Pick an application</NativeSelectOption>
          {choices.map((choice) => (
            <NativeSelectOption key={choice.id} value={choice.id}>
              {choice.company}: {choice.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" size="sm" disabled={!jobId || file.isPending}>
          File it
        </Button>
      </div>
      {file.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {file.error.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The Applications page's paste box, and the emails pasted there lately:
 * being read, waiting to be placed, or just filed. The page prefetches them.
 * When one is read, the page reloads its list to show what changed.
 */
export function PastedEmails({ choices }: { choices: Choice[] }) {
  const router = useRouter();
  const { data: emails } = useSuspenseQuery(pastedEmailsQuery());
  useOnEmailsRead(emails, () => router.refresh());

  return (
    <section aria-label="Paste an email" className="flex flex-col gap-3">
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <PasteEmail
          jobId={null}
          label="Got an email from a company? Paste it here."
          hint="Claude finds the application, updates its status, sums the email up and writes your reply."
        />
      </div>
      {emails.length > 0 ? (
        <ol aria-label="Emails pasted lately" className="flex flex-col gap-3">
          {emails.map((email) => (
            <li key={email.id}>
              <EmailCard email={email} job={email.job}>
                {email.status !== "reading" && !email.jobId ? (
                  <FileUnder
                    emailId={email.id}
                    failed={email.status === "failed"}
                    choices={choices}
                  />
                ) : null}
              </EmailCard>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
