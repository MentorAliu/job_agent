import "server-only";

import { buildApplicationsQuery } from "@/lib/applications/query";
import {
  APPLICATIONS_PAGE_SIZE,
  type ApplicationsParams,
  type ApplicationStage,
} from "@/lib/applications/params";
import type { EmailAuthor, MailOutcome } from "@/lib/schemas/mail";
import type { JobStatus } from "@/lib/schemas/tracker";

import { db } from "./db";
import { getCurrentUser } from "./session";

// The Applications page and the Overview's Your turn: every role applied
// to, with its latest email and whose move it is.

export type ApplicationRow = {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  appliedAt: string | null;
  /** The latest email, or the application when there's none. */
  lastActivityAt: string | null;
  /** The company's latest email is waiting for the owner's reply. */
  yourTurn: boolean;
  /** Emails about this role. */
  emailCount: number;
  latestEmail: {
    id: string;
    author: EmailAuthor | null;
    outcome: MailOutcome | null;
    sure: boolean | null;
    senderName: string | null;
    summary: string | null;
    pastedAt: string;
  } | null;
};

export type ApplicationsPage = {
  rows: ApplicationRow[];
  /** How many applications match the search in each stage. */
  stages: Record<ApplicationStage, number>;
  page: number;
  size: number;
};

export async function listApplications(
  params: ApplicationsParams,
  {
    size = APPLICATIONS_PAGE_SIZE,
    now = new Date(),
  }: { size?: number; now?: Date } = {},
): Promise<ApplicationsPage> {
  await getCurrentUser();
  const query = buildApplicationsQuery(db, params, now, size);
  const [rows, [counts]] = await Promise.all([query.rows, query.counts]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      status: row.status,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      yourTurn: row.yourTurn,
      emailCount: row.emailCount,
      latestEmail:
        row.latestEmail?.id && row.latestEmail.pastedAt
          ? {
              ...row.latestEmail,
              id: row.latestEmail.id,
              pastedAt: row.latestEmail.pastedAt.toISOString(),
            }
          : null,
    })),
    stages: counts ?? {
      all: 0,
      your_turn: 0,
      waiting: 0,
      interviewing: 0,
      offer: 0,
      closed: 0,
    },
    page: params.page,
    size,
  };
}
