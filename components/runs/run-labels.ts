import type { RunSummary } from "@/lib/dal/runs";
import type { MonthActivity } from "@/lib/dal/spend";
import type { Eligibility, RunStage, RunStatus } from "@/lib/schemas/job";
import type { LlmStage } from "@/lib/schemas/settings";

export const STAGE_LABELS: Record<RunStage, string> = {
  queued: "Waiting to start",
  discovering: "Searching job boards",
  extracting: "Reading postings",
  scoring: "Scoring matches",
  done: "Done",
};

export const STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Finished",
  stopped: "Stopped",
  failed: "Failed",
};

export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  eligible: "Eligible",
  unclear: "Unclear",
  not_eligible: "Not eligible",
};

/** One line on where a running search is, for the header and the run page. */
export function progressLine(run: Pick<RunSummary, "stats">): string {
  const { stats } = run;
  switch (stats.stage) {
    case "extracting":
      return `Reading postings: ${stats.read} of up to ${stats.toRead}`;
    case "scoring":
      return stats.toScore > 0
        ? `Scoring ${stats.toScore} matches`
        : STAGE_LABELS.scoring;
    default:
      return STAGE_LABELS[stats.stage];
  }
}

/** How long a run took, such as "4 min". */
export function duration(startIso: string, endIso: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000),
  );
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 0.1 ? 3 : 2)}`;
}

/** A budget cap, such as "$20", with cents only when it has some. */
export function formatBudget(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : formatCost(usd);
}

/** A UTC day, such as "1 Nov", for when the budget resets. */
export function shortDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

const DAY_MS = 864e5;

/**
 * What this month's spend would come to if the days left went like the days
 * so far. Null in the first two days, when there's too little to go on.
 */
export function monthPace(
  activity: Pick<MonthActivity, "monthStart" | "nextMonthStart" | "spentUsd">,
  now: Date,
): number | null {
  const start = Date.parse(activity.monthStart);
  const end = Date.parse(activity.nextMonthStart);
  const elapsed = (now.getTime() - start) / DAY_MS;
  if (elapsed < 2 || activity.spentUsd <= 0) return null;
  return (activity.spentUsd / elapsed) * ((end - start) / DAY_MS);
}

/** What each Claude step does, for Settings and the spend tables. */
export const LLM_STAGE_LABELS: Record<
  LlmStage,
  { label: string; description: string }
> = {
  parse_cv: {
    label: "Read CV",
    description: "Turns an uploaded CV into your profile, once per upload.",
  },
  discover: {
    label: "Search job boards",
    description:
      "Up to 3 web searches per call: one call for each group of job sites, and one on the rest of the web for companies' own careers pages. Uses Claude Sonnet 5.5 instead if the model can't search.",
  },
  extract: {
    label: "Read postings",
    description: "Reads one posting and pulls out its key facts.",
  },
  score: {
    label: "Score matches",
    description:
      "Scores eligible postings against your profile, through the half-price Batch API.",
  },
  company_snapshot: {
    label: "Company snapshot",
    description:
      "A short brief on the company when you shortlist a role. Uses Claude Sonnet 5.5 instead if the model can't search.",
  },
  tailor: {
    label: "Tailor documents",
    description:
      "Writes the CV, cover letter and answers for a shortlisted role.",
  },
  claim_check: {
    label: "Check claims",
    description: "Checks each tailored line against the facts it cites.",
  },
  read_email: {
    label: "Read emails",
    description:
      "Reads an email you paste from a company, moves the role on, sums it up and suggests a reply.",
  },
  build_cv: {
    label: "Build CVs",
    description:
      "Writes a CV from your profile when you build one on the CVs page.",
  },
  check_engine: {
    label: "Check provider",
    description:
      "One tiny call that checks the agents' provider works, in setup or from Settings.",
  },
};
