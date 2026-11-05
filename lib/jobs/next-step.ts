// What a role in the tracker waits on: a follow-up that's due, answers only
// the owner can give, a kit ready to send, or tailoring that's going or
// failed. The tracker's "Last change" column, its cards and its "Needs you"
// group all read it from here.
import type { JobListRow } from "@/lib/dal/jobs";
import { TAILORABLE_STATUSES } from "@/lib/schemas/tailor";
import { CLOSED_STATUSES, type JobStatus } from "@/lib/schemas/tracker";

export type FollowUpState =
  | { kind: "late"; days: number }
  | { kind: "today" }
  /** Set for a later day, or on a role that's over and no longer due. */
  | { kind: "set"; on: string };

type Row = Pick<
  JobListRow,
  "status" | "followUpOn" | "tailoring" | "answersForYou"
>;

/** Days from one "YYYY-MM-DD" to another. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5,
  );
}

/** Where a role's follow-up stands on the owner's `today`. */
export function followUpState(
  row: Pick<JobListRow, "status" | "followUpOn">,
  today: string,
): FollowUpState | null {
  const on = row.followUpOn;
  if (on === null) return null;
  if (on > today || CLOSED_STATUSES.includes(row.status)) {
    return { kind: "set", on };
  }
  return on === today
    ? { kind: "today" }
    : { kind: "late", days: daysBetween(on, today) };
}

export type NextStep =
  | { kind: "follow_up"; late: number }
  | { kind: "answers"; count: number }
  | { kind: "kit_ready" }
  | { kind: "tailoring" }
  | { kind: "tailoring_failed" }
  | { kind: "offer" };

/**
 * The next thing that happens to the role, if anything is waiting: a
 * follow-up that's due comes first, then the apply kit, then an offer to
 * answer.
 */
export function nextStep(row: Row, today: string): NextStep | null {
  const followUp = followUpState(row, today);
  if (followUp?.kind === "late")
    return { kind: "follow_up", late: followUp.days };
  if (followUp?.kind === "today") return { kind: "follow_up", late: 0 };

  if ((TAILORABLE_STATUSES as readonly JobStatus[]).includes(row.status)) {
    if (row.tailoring === "active") return { kind: "tailoring" };
    if (row.tailoring === "failed") return { kind: "tailoring_failed" };
    if (row.answersForYou) return { kind: "answers", count: row.answersForYou };
    if (row.status === "ready") return { kind: "kit_ready" };
  }
  return row.status === "offer" ? { kind: "offer" } : null;
}

/** Whether the step is the owner's: everything but Claude's tailoring. */
export function needsYou(step: NextStep | null): step is NextStep {
  return step !== null && step.kind !== "tailoring";
}
