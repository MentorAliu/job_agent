import type { RunSummary } from "@/lib/dal/runs";
import type { SearchBlock } from "@/lib/pipeline/runs";
import { isBuildActive, type BuiltCvStatus } from "@/lib/schemas/cv-builder";
import { isRunActive, type RunStats } from "@/lib/schemas/job";
import { isTailoringActive, type TailorState } from "@/lib/schemas/tailor";

import { AUTO_KITS_PER_DAY } from "./auto-pick";
import { DAILY_RUN_HOUR, DAILY_RUN_TIME } from "./today";

// The bar above every page: how the daily search is doing, how many roles
// are new since the owner last looked, and the one thing that needs them.

/** Where the searches stand. The first that applies wins. */
export type SearchState =
  "searching" | "setup" | "budget" | "off" | "failed" | "on";

export type SearchStatus = {
  state: SearchState;
  /** The search going now, or the one that failed. */
  runId: string | null;
  /** How far the search going now has got, when it was read. */
  stats: RunStats | null;
  /** When the daily search runs next, if it will. */
  nextSearch: "today" | "tomorrow" | null;
  /** Why no search can run, when setup or the budget stops it. */
  reason: string | null;
  /** Roles shortlisted today, by the app or by hand. */
  kitsToday: number;
};

/** The one thing waiting on the owner: a reply first, then a kit to send. */
export type NextStep =
  | { kind: "reply" | "apply"; jobId: string; company: string }
  | { kind: "none" };

export type TopBarView = {
  search: SearchStatus;
  /** Roles found since the owner last opened Roles. */
  newRoles: number;
  next: NextStep;
  /**
   * Whether Claude is busy with something besides a search, so the bar keeps
   * checking and refreshes the page, spend included, once it's done.
   */
  working: boolean;
};

/**
 * How long the bar keeps checking after a search ends: the search picks its
 * best roles a moment later, and their kits start then.
 */
export const AFTER_SEARCH_MS = 60_000;

/** An uploaded CV still unread after this long never will be. */
export const CV_READ_MS = 15 * 60_000;

/**
 * Whether Claude is busy with something besides the search going now: a
 * search that only just ended, an apply kit, a built CV, or an email or CV
 * it's reading. Work that never finished doesn't count.
 */
export function claudeWorking(
  {
    latest,
    kits,
    cvs,
    reads,
  }: {
    latest: Pick<RunSummary, "status" | "finishedAt"> | null;
    /** Tailoring requests marked queued or running. */
    kits: TailorState[];
    /** Built CVs not marked ready or failed. */
    cvs: { status: BuiltCvStatus; createdAt: Date; updatedAt?: Date }[];
    /** Emails, uploaded CVs and added roles being read, within their time limits. */
    reads: number;
  },
  now: Date,
): boolean {
  const ms = now.getTime();
  const searchJustEnded =
    latest !== null &&
    !isRunActive(latest.status) &&
    latest.finishedAt !== null &&
    ms - Date.parse(latest.finishedAt) < AFTER_SEARCH_MS;
  return (
    searchJustEnded ||
    kits.some((kit) => isTailoringActive(kit, ms)) ||
    cvs.some((cv) => isBuildActive(cv, ms)) ||
    reads > 0
  );
}

export function searchStatus({
  latest,
  block,
  dailyRunOn,
  hour,
  kitsToday,
}: {
  latest: Pick<RunSummary, "id" | "status" | "stats"> | null;
  block: SearchBlock | null;
  dailyRunOn: boolean;
  /** The owner's hour of the day. */
  hour: number;
  kitsToday: number;
}): SearchStatus {
  const state: SearchState =
    latest && isRunActive(latest.status)
      ? "searching"
      : block
        ? block.cause
        : !dailyRunOn
          ? "off"
          : latest?.status === "failed"
            ? "failed"
            : "on";
  const runs = state === "on" || state === "failed";
  return {
    state,
    runId:
      state === "searching" || state === "failed" ? (latest?.id ?? null) : null,
    stats: state === "searching" ? (latest?.stats ?? null) : null,
    nextSearch: runs ? (hour < DAILY_RUN_HOUR ? "today" : "tomorrow") : null,
    reason:
      state === "setup" || state === "budget" ? (block?.reason ?? null) : null,
    kitsToday,
  };
}

type Waiting = { jobId: string; company: string } | null;

/** Replies come first: a company is waiting. Then a kit ready to send. */
export function nextStep(reply: Waiting, kit: Waiting): NextStep {
  if (reply) return { kind: "reply", ...reply };
  if (kit) return { kind: "apply", ...kit };
  return { kind: "none" };
}

/** The search's line in the bar: what's going on, then what comes next. */
export function searchLabel(status: SearchStatus): {
  title: string;
  detail: string | null;
} {
  const at = status.nextSearch && `${status.nextSearch} at ${DAILY_RUN_TIME}`;
  switch (status.state) {
    case "searching":
      return { title: "Searching now", detail: null };
    case "setup":
      return { title: "Not ready to search", detail: "Finish setting up" };
    case "budget":
      return {
        title: "Searches paused",
        detail: "This month's budget is spent",
      };
    case "off":
      return { title: "Daily search off", detail: "Turn it on in Settings" };
    case "failed":
      return { title: "Last search failed", detail: at && `Next try ${at}` };
    case "on":
      return { title: "Daily search on", detail: at && `Next ${at}` };
  }
}

/** "2 of 3 kits today", or just the count once roles picked by hand pass the limit. */
export function kitsTodayLabel(kitsToday: number): string {
  return kitsToday > AUTO_KITS_PER_DAY
    ? `${kitsToday} kits today`
    : `${kitsToday} of ${AUTO_KITS_PER_DAY} kits today`;
}

/** Where the search's line leads: the run, or where to fix what stops it. */
export function searchHref(status: SearchStatus): string {
  switch (status.state) {
    case "searching":
    case "failed":
      return status.runId ? `/runs/${status.runId}` : "/runs";
    case "setup":
      return "/";
    case "budget":
    case "off":
      return "/settings";
    case "on":
      return "/runs";
  }
}
