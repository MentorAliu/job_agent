import { ActivityIcon } from "lucide-react";
import Link from "next/link";

import { describeEvent } from "@/components/jobs/event-labels";
import { RelativeDate } from "@/components/jobs/relative-date";
import { roleHref } from "@/lib/applications/progress";
import type { ActivityEvent } from "@/lib/dal/overview";
import { cn } from "@/lib/utils";

import { Panel, PanelEmpty } from "./panel";

/** The latest kits, emails and status moves, newest first. */
export function ActivityCard({
  events,
  today,
}: {
  events: ActivityEvent[];
  today: string;
}) {
  return (
    <Panel title="What happened" icon={<ActivityIcon />}>
      {events.length === 0 ? (
        <PanelEmpty>
          Nothing yet. Kits, applications and replies show up here.
        </PanelEmpty>
      ) : (
        <ol className="flex flex-col border-t px-4 py-3 sm:px-5">
          {events.map((event, index) => {
            const entry = describeEvent(event, today);
            return (
              <li
                key={event.id}
                className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-3 pb-3 last:pb-0"
              >
                <span aria-hidden className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full ring-3 ring-card",
                      entry.dot,
                    )}
                  />
                  {index < events.length - 1 ? (
                    <span className="mt-1 -mb-2 w-px flex-1 bg-border" />
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{entry.title}</span>
                  <Link
                    href={roleHref(event.job)}
                    className="truncate rounded-sm text-[0.8125rem] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {event.job.title} at {event.job.company}
                  </Link>
                </span>
                <RelativeDate
                  iso={event.at}
                  kind="short"
                  className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                />
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
