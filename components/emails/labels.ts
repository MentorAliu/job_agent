import type { EmailAuthor, MailOutcome } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

// How a pasted email's outcome reads, on its card, on the timeline and in
// the lists.

export const OUTCOME_LABELS: Record<MailOutcome, string> = {
  received: "Application received",
  rejected: "Not going ahead",
  interview: "Interview invite",
  assessment: "A task to do",
  offer: "An offer",
  other: "A message",
  unrelated: "Not about this role",
};

/** The status each kind of email points to, for its dot and its tag. */
export const OUTCOME_STATUSES: Record<MailOutcome, JobStatus> = {
  received: "applied",
  rejected: "rejected",
  interview: "interviewing",
  assessment: "interviewing",
  offer: "offer",
  other: "applied",
  unrelated: "withdrawn",
};

/** "Interview invite", "Your reply", or "Email to check" when Claude wasn't sure. */
export function emailLabel(email: {
  author: EmailAuthor | null;
  outcome: MailOutcome | null;
  sure: boolean | null;
}): string {
  if (email.author === "candidate") return "Your reply";
  if (!email.outcome) return "Email";
  if (email.outcome !== "unrelated" && email.sure === false) {
    return "Email to check";
  }
  return OUTCOME_LABELS[email.outcome];
}
