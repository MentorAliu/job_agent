import { FileTextIcon, MailIcon, SparklesIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ApplicationRows } from "@/components/applications/applications-list";
import { ActivityCard } from "@/components/overview/activity";
import { FunnelCard } from "@/components/overview/funnel";
import { OverviewKpis } from "@/components/overview/kpis";
import { Panel, PanelEmpty } from "@/components/overview/panel";
import { kitState, RoleRows } from "@/components/overview/role-rows";
import { LastSearchStrip, SetupCard } from "@/components/overview/status-cards";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_APPLICATIONS_PARAMS } from "@/lib/applications/params";
import { listApplications } from "@/lib/dal/applications";
import { listJobs } from "@/lib/dal/jobs";
import { getOverviewStats, getRecentActivity } from "@/lib/dal/overview";
import { getProfileName } from "@/lib/dal/profile";
import { getOwnerTimeZone } from "@/lib/dal/settings";
import {
  getLatestRun,
  getSearchBlock,
  getSearchReadiness,
} from "@/lib/dal/runs";
import { requireUser } from "@/lib/dal/session";
import { getMonthActivity } from "@/lib/dal/spend";
import { AUTO_KITS_PER_DAY, AUTO_PICK_MIN_SCORE } from "@/lib/jobs/auto-pick";
import { NEXT_UP_PARAMS, TO_SEND_PARAMS } from "@/lib/jobs/list-params";
import { dayIn, hourIn } from "@/lib/jobs/today";

/** How many roles each list shows before linking to the rest. */
const SHOWN = 5;

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewLoader />
    </Suspense>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={<Skeleton className="h-4 w-72" />}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const moreLink =
  "rounded-sm text-[0.8125rem] font-semibold whitespace-nowrap text-primary-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Everything the Overview shows, read on the server. Nothing here asks for
 * input: the searches, the picking and the kits all run on their own.
 */
async function OverviewLoader() {
  await requireUser();
  const now = new Date();
  const [
    timeZone,
    name,
    missing,
    block,
    latest,
    stats,
    activity,
    events,
    toSend,
    nextUp,
    yourTurn,
  ] = await Promise.all([
    getOwnerTimeZone(),
    getProfileName(),
    getSearchReadiness(),
    getSearchBlock(),
    getLatestRun(),
    getOverviewStats(now),
    getMonthActivity(now),
    getRecentActivity(),
    listJobs(TO_SEND_PARAMS),
    listJobs(NEXT_UP_PARAMS),
    listApplications(
      { ...DEFAULT_APPLICATIONS_PARAMS, stage: "your_turn" },
      { size: SHOWN, now },
    ),
  ]);

  const today = dayIn(timeZone, now);
  const hour = hourIn(timeZone, now);
  const ready = toSend.statuses.ready.count;
  const writing = toSend.statuses.shortlisted.count;
  const replies = yourTurn.stages.your_turn;
  // What needs the owner. How the search is doing is in the top bar.
  const summary = [
    replies > 0
      ? `${plural(replies, "company is", "companies are")} waiting for your reply.`
      : null,
    ready > 0
      ? `${plural(ready, "kit is", "kits are")} ready to send.`
      : writing > 0
        ? `${plural(writing, "kit is", "kits are")} being written.`
        : replies > 0
          ? null
          : "Nothing needs you right now.",
  ]
    .filter(Boolean)
    .join(" ");
  const firstName = name?.split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={firstName ? `${greeting(hour)}, ${firstName}` : greeting(hour)}
        description={summary}
      />

      {block?.cause === "budget" ? (
        <Alert>
          <WalletIcon aria-hidden />
          <AlertTitle>Monthly budget reached</AlertTitle>
          <AlertDescription>
            <p>{block.reason}</p>
            <p>
              <Link href="/settings" className="underline underline-offset-4">
                Open Settings
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {missing.length > 0 ? <SetupCard missing={missing} /> : null}

      <OverviewKpis stats={stats} activity={activity} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {replies > 0 ? (
            <Panel
              title="Your turn"
              description="Companies waiting for your answer. Each has a reply ready to copy."
              icon={<MailIcon />}
              tone="warning"
              count={replies}
              action={
                replies > SHOWN ? (
                  <Link
                    href="/applications?stage=your_turn"
                    className={moreLink}
                  >
                    See all
                  </Link>
                ) : null
              }
            >
              <ApplicationRows
                label="Waiting for your reply"
                rows={yourTurn.rows}
                className="border-t"
                markTurn={false}
              />
            </Panel>
          ) : null}
          <Panel
            title="Ready to send"
            description={`The app picks up to ${AUTO_KITS_PER_DAY} roles a day that score ${AUTO_PICK_MIN_SCORE} or more, and writes their kits.`}
            icon={<FileTextIcon />}
            tone="ready"
            count={toSend.total}
            action={
              toSend.total > SHOWN ? (
                <Link href="/jobs" className={moreLink}>
                  See all
                </Link>
              ) : null
            }
          >
            {toSend.rows.length === 0 ? (
              <PanelEmpty>
                No kits right now. The next strong match gets one.
              </PanelEmpty>
            ) : (
              <RoleRows
                label="Kits to send"
                rows={toSend.rows.slice(0, SHOWN)}
                today={today}
                state={(row) => kitState(row, today)}
              />
            )}
          </Panel>
          <ActivityCard events={events} today={today} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <FunnelCard funnel={stats.funnel} />
          {nextUp.total > 0 ? (
            <Panel
              title="Next up"
              description={`Strong roles waiting for a free kit. Up to ${AUTO_KITS_PER_DAY} get one each day.`}
              icon={<SparklesIcon />}
              count={nextUp.total}
              action={
                nextUp.total > 3 ? (
                  <Link href="/jobs?tab=waiting" className={moreLink}>
                    See all
                  </Link>
                ) : null
              }
            >
              <RoleRows
                label="Strong roles waiting"
                rows={nextUp.rows.slice(0, 3)}
                today={today}
              />
            </Panel>
          ) : null}
        </div>
      </div>

      <LastSearchStrip latest={latest} />
    </div>
  );
}
