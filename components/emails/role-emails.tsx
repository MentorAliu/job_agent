"use client";

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import type { PastedEmailView } from "@/lib/dal/emails";
import { jobsKey, roleEmailsQuery } from "@/lib/jobs/queries";

import { EmailCard } from "./email-card";
import { PasteEmail } from "./paste-email";

/**
 * Calls `onRead` when an email that was being read is read (or fails), so
 * what it changed shows elsewhere on the page.
 */
export function useOnEmailsRead(
  emails: readonly PastedEmailView[] | undefined,
  onRead: () => void,
) {
  const reading = useRef(new Set<string>());
  const read = useEffectEvent(onRead);
  useEffect(() => {
    if (!emails) return;
    const now = new Set(
      emails
        .filter((email) => email.status === "reading")
        .map((email) => email.id),
    );
    const finished = [...reading.current].some((id) => !now.has(id));
    reading.current = now;
    if (finished) read();
  }, [emails]);
}

/**
 * A role's emails, newest first, with the box to paste the next one, once
 * the role is applied to or has emails. Polls while Claude reads one, then
 * refreshes the role's status and timeline.
 */
export function RoleEmails({
  jobId,
  company,
  applied,
}: {
  jobId: string;
  company: string;
  /** The role is applied to, so emails are expected. */
  applied: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: emails } = useSuspenseQuery(roleEmailsQuery(jobId));
  useOnEmailsRead(emails, () =>
    queryClient.invalidateQueries({
      queryKey: jobsKey,
      predicate: (query) => query.queryKey[1] !== "emails",
    }),
  );
  if (!applied && emails.length === 0) return null;

  return (
    <section
      id="emails"
      aria-labelledby="emails-heading"
      className="flex scroll-mt-20 flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="emails-heading" className="text-lg font-semibold">
          Emails
        </h2>
        <p className="text-sm text-muted-foreground">
          Paste each email {company} sends you. Claude sums it up, moves the
          role on and writes your reply.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <PasteEmail
          jobId={jobId}
          label={
            emails.length > 0
              ? `Got another email from ${company}?`
              : `Paste an email from ${company}`
          }
          hint="Your replies count too: paste one you sent and the next reading takes it into account."
        />
      </div>
      {emails.length > 0 ? (
        <ol aria-label="Emails, newest first" className="flex flex-col gap-3">
          {emails.map((email) => (
            <li key={email.id}>
              <EmailCard email={email} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
