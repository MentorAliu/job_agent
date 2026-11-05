// What an email from a company does to its role. Claude only says what the
// email means; these rules, not the email, decide what changes. A role only
// moves forward: an interview invite never undoes an offer. The one way back
// is out of No response, since any email means they did answer.
import type { ReplyOutcome } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

/** Roles the owner applied to: everything from Applied on. */
export const APPLIED_STATUSES = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "no_response",
  "withdrawn",
] as const satisfies readonly JobStatus[];

/** Applications that may still get a reply, or need one from the owner. */
export const AWAITING_REPLY_STATUSES = [
  "applied",
  "interviewing",
  "offer",
  "no_response",
] as const satisfies readonly JobStatus[];

const MOVES: Record<
  Exclude<ReplyOutcome, "received" | "other">,
  { to: JobStatus; from: readonly JobStatus[] }
> = {
  rejected: {
    to: "rejected",
    from: ["applied", "interviewing", "offer", "no_response"],
  },
  interview: { to: "interviewing", from: ["applied", "no_response"] },
  assessment: { to: "interviewing", from: ["applied", "no_response"] },
  offer: { to: "offer", from: ["applied", "interviewing", "no_response"] },
};

/**
 * The status a role at `status` moves to for an email Claude read as
 * `outcome`, or null to leave it. An unsure reading changes nothing.
 */
export function replyUpdate(
  status: JobStatus,
  outcome: ReplyOutcome,
  sure: boolean,
): JobStatus | null {
  if (!sure) return null;
  if (outcome === "received" || outcome === "other") {
    return status === "no_response" ? "applied" : null;
  }
  const move = MOVES[outcome];
  return move.from.includes(status) ? move.to : null;
}
