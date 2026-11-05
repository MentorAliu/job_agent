// How a change to a role looks in the cache before the server confirms it.
// The caches are refetched once the write settles.
import type { JobListRow } from "@/lib/dal/jobs";
import type { JobStatus } from "@/lib/schemas/tracker";

import type { JobCounts } from "./queries";
import { WORKING_STATUSES } from "./stages";

/**
 * A status change as the row shows it, with the date it changed and the
 * applied date it sets.
 */
export function withStatus(status: JobStatus, now: Date = new Date()) {
  return <T extends JobListRow>(row: T): T => ({
    ...row,
    status,
    statusAt: status === row.status ? row.statusAt : now.toISOString(),
    appliedAt:
      status === "applied" && row.appliedAt === null
        ? now.toISOString()
        : row.appliedAt,
  });
}

/**
 * The nav's counts once a role changes: whether its kit is ready to send,
 * and whether it's being worked on. Whose turn it is depends on its emails,
 * so that count waits for the refetch.
 */
export function adjustCounts(
  counts: JobCounts,
  before: JobListRow,
  after: JobListRow,
): JobCounts {
  const ready = (row: JobListRow) => row.status === "ready";
  const working = (row: JobListRow) =>
    (WORKING_STATUSES as readonly JobStatus[]).includes(row.status);
  const count = (current: number, test: (row: JobListRow) => boolean) =>
    Math.max(0, current + Number(test(after)) - Number(test(before)));
  return {
    ...counts,
    readyToSend: count(counts.readyToSend, ready),
    inProgress: count(counts.inProgress, working),
  };
}
