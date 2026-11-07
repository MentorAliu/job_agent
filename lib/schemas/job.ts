// Job postings: the facts Claude reads from a posting (step 4), the score it
// gives a posting against the profile (step 6), and a search run's progress.
// The same schemas type the jsonb columns in `job` and `run`.
import { z } from "zod";

import { SENIORITY_LEVELS } from "./profile";

// ---------------------------------------------------------------------------
// What Claude returns when it reads a posting (step 4)
// ---------------------------------------------------------------------------

export const WORKPLACE_TYPES = [
  "remote",
  "hybrid",
  "onsite",
  "unclear",
] as const;
export const CONTRACT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "unclear",
] as const;
export const JOB_SENIORITY = [...SENIORITY_LEVELS, "unclear"] as const;
/** What the places a posting lists mean for where a candidate may live. */
export const PLACE_RULES = [
  "required",
  "preferred",
  "team_locations",
  "not_given",
] as const;
export const JOB_SALARY_PERIODS = [
  "year",
  "month",
  "day",
  "hour",
  "unclear",
] as const;

// As with the CV schema, every field is required and plain: structured
// outputs limit optional fields and numeric constraints, and the code checks
// the values itself. Quotes must be copied exactly, because the eligibility
// check looks for them in the fetched page.
const QUOTE_HINT =
  "Copied exactly from the posting, word for word. Empty string when the posting says nothing about it.";

export const jobExtractionSchema = z.object({
  isJobPosting: z
    .boolean()
    .describe(
      "True only when the page is one open job posting. False for a list of jobs, a closed or expired posting, an error page or a sign-in page.",
    ),
  company: z.string().describe("The hiring company's name."),
  title: z.string().describe("The job title, as the posting writes it."),
  summary: z
    .string()
    .describe("Two or three plain sentences on what the role is."),
  location: z.object({
    workplace: z
      .enum(WORKPLACE_TYPES)
      .describe(
        '"remote": the candidate can work fully remote, with no regular office days. "hybrid": regular days or weeks in an office, or having to live within reach of one. "onsite": the work is at an office or a client\'s site. "unclear": the posting doesn\'t say.',
      ),
    quote: z
      .string()
      .describe(
        `The posting's sentence about where candidates may live or work from. ${QUOTE_HINT}`,
      ),
    allowed: z
      .array(z.string())
      .describe(
        'Every country or region the posting says candidates may work from, in English: country names such as "Germany", or regions such as "Worldwide", "Europe", "EU", "EEA", "EMEA", "North America", "LATAM", "APAC". Empty when the posting doesn\'t say.',
      ),
    placesAre: z
      .enum(PLACE_RULES)
      .describe(
        'What the allowed places mean. "required": candidates must live or work there, as in "US only" or "open to candidates in Europe". "preferred": the posting prefers them but doesn\'t rule out other places, as in "preference for the UK or Ireland". "team_locations": they are where the company, its offices or its current staff are, not a rule for candidates, as in "our engineers are based in Germany and Poland". "not_given": the posting names no places.',
      ),
    excluded: z
      .array(z.string())
      .describe(
        "Countries or regions the posting says candidates may not work from. Empty when it names none.",
      ),
  }),
  timeZones: z.object({
    quote: z
      .string()
      .describe(
        `The posting's sentence about working hours or time zones. ${QUOTE_HINT}`,
      ),
    utcOffsetMin: z
      .number()
      .nullable()
      .describe(
        'The westernmost UTC offset in hours a candidate may work from. "CET ±2" means UTC+1 plus or minus 2, so -1. Null when the posting gives no time zone range, or only asks for some hours of overlap with a time zone.',
      ),
    utcOffsetMax: z
      .number()
      .nullable()
      .describe(
        'The easternmost UTC offset in hours. For "CET ±2", 3. Null when the posting gives no time zone range.',
      ),
  }),
  salary: z.object({
    quote: z.string().describe(QUOTE_HINT),
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z
      .string()
      .describe(
        'A three-letter code such as "EUR". Empty string when unknown.',
      ),
    period: z.enum(JOB_SALARY_PERIODS),
  }),
  stack: z
    .array(z.string())
    .describe("Languages, frameworks and tools the posting names."),
  seniority: z.enum(JOB_SENIORITY),
  contract: z.enum(CONTRACT_TYPES),
  deadline: z
    .string()
    .describe(
      'The application deadline as "YYYY-MM-DD". Empty string when none.',
    ),
  posted: z.object({
    quote: z
      .string()
      .describe(
        `The posting's words on when it was posted, such as "Posted 3 days ago" or "Published 12 October 2026". ${QUOTE_HINT}`,
      ),
    date: z
      .string()
      .describe(
        "The day it was posted as \"YYYY-MM-DD\", worked out from the quote and today's date. Empty string when the posting doesn't say.",
      ),
  }),
  applyUrl: z
    .string()
    .describe(
      "The link to the application form, if the page shows one. Empty string otherwise.",
    ),
  requirements: z
    .array(z.string())
    .describe("The must-have requirements, one short line each."),
  applicationRules: z
    .array(z.string())
    .describe(
      "What the posting asks applicants to do or send: a cover letter, a portfolio, answers to questions, a test task. One short line each.",
    ),
  aiPolicy: z
    .string()
    .describe(
      `What the posting says about using AI tools when applying. ${QUOTE_HINT}`,
    ),
});

export type JobExtraction = z.infer<typeof jobExtractionSchema>;

/**
 * The facts stored on a job: the extraction minus the posting check and the
 * posting date, which has its own column.
 */
export type JobFacts = Omit<JobExtraction, "isJobPosting" | "posted">;

export const ELIGIBILITY = ["eligible", "not_eligible", "unclear"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

// ---------------------------------------------------------------------------
// What Claude returns when it scores a posting (step 6)
// ---------------------------------------------------------------------------

/** What a role mainly works on. Frontend roles get kits first. */
export const ROLE_FOCUS = [
  "frontend",
  "fullstack",
  "backend",
  "mobile",
  "other",
] as const;
export type RoleFocus = (typeof ROLE_FOCUS)[number];

// The reasons and gaps come before the score, so the score follows from them.
export const jobScoreSchema = z.object({
  focus: z
    .enum(ROLE_FOCUS)
    .describe(
      '"frontend": mostly user interfaces and web apps, in any framework. "fullstack": both the interface and the server, with real frontend work. "backend": servers, APIs, data or infrastructure. "mobile": native iOS or Android apps, or React Native. "other": anything else.',
    ),
  reasons: z
    .array(z.string())
    .describe(
      "Up to four short reasons the candidate fits, each naming the profile fact and the requirement it meets.",
    ),
  gaps: z
    .array(z.string())
    .describe(
      "Up to four requirements the profile doesn't show, or other mismatches such as seniority or salary.",
    ),
  score: z
    .number()
    .describe(
      "How well the candidate matches the role, from 0 to 100. 80 or more: a strong match worth applying to. 50 to 79: a partial match. Below 50: a poor match.",
    ),
});

export type JobScore = z.infer<typeof jobScoreSchema>;

/**
 * What a command-line agent returns from a search (step 2). The API gives the
 * links in its search result blocks; an agent lists them in its answer.
 */
export const foundPostingsSchema = z.object({
  urls: z
    .array(z.string())
    .max(40)
    .describe(
      "The links of single open postings from the search results, copied exactly.",
    ),
});

/** `job.score_reasons`: why the score is what it is. */
export type ScoreReasons = { reasons: string[]; gaps: string[] };

// ---------------------------------------------------------------------------
// Search runs
// ---------------------------------------------------------------------------

export const RUN_STAGES = [
  "queued",
  "discovering",
  "extracting",
  "scoring",
  "done",
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/**
 * `run.stats`: a run's progress, updated by each step. How many postings
 * were saved, and their verdicts and scores, come from the `job` rows.
 */
export type RunStats = {
  stage: RunStage;
  /** Job boards checked of companies with a role the owner can take. */
  boards: number;
  /** New postings on those boards this run reads. */
  boardPostings: number;
  /** Remote job boards whose own feeds were read (see lib/jobs/feeds.ts). */
  feeds: number;
  /** New postings from those feeds this run reads. */
  feedPostings: number;
  /** Web searches made. */
  searches: number;
  /** Posting links in the search results. */
  found: number;
  /** Links not seen in an earlier run. */
  fresh: number;
  /**
   * Postings this run reads, from the boards, the feeds and the searches: at most
   * MAX_POSTINGS_PER_RUN, and fewer once there are enough matches to score.
   */
  toRead: number;
  /** Postings read so far, whatever the outcome. */
  read: number;
  /** Postings already stored under another link. */
  duplicates: number;
  /** Pages that weren't an open posting or couldn't be read. */
  skipped: number;
  /** Postings sent for scoring, and the ones that came back without a score. */
  toScore: number;
  scoreFailed: number;
  /**
   * Roles found earlier that this run scores again, after a change to the
   * profile or preferences that scoring reads. Runs before this have none.
   */
  rescored?: number;
  /** Why the run stopped early, or why it failed. */
  stopReason?: string;
};

export const RUN_COUNTERS = [
  "boards",
  "boardPostings",
  "feeds",
  "feedPostings",
  "searches",
  "found",
  "fresh",
  "toRead",
  "read",
  "duplicates",
  "skipped",
  "toScore",
  "scoreFailed",
  "rescored",
] as const satisfies readonly (keyof RunStats)[];
export type RunCounter = (typeof RUN_COUNTERS)[number];

export function emptyRunStats(stage: RunStage = "queued"): RunStats {
  return {
    stage,
    boards: 0,
    boardPostings: 0,
    feeds: 0,
    feedPostings: 0,
    searches: 0,
    found: 0,
    fresh: 0,
    toRead: 0,
    read: 0,
    duplicates: 0,
    skipped: 0,
    toScore: 0,
    scoreFailed: 0,
  };
}

/**
 * What started a run: the daily clock, Search now, or a saved change to the
 * profile or job preferences that scoring reads (inngest/profile-changed.ts).
 */
export const RUN_TRIGGERS = ["scheduled", "manual", "profile"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** How the run pages name what started a run. */
export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  scheduled: "Daily run",
  manual: "Search now",
  profile: "After a profile change",
};

export const RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "stopped",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Whether the run has ended, so its page can stop polling. */
export function isRunActive(status: RunStatus): boolean {
  return status === "running";
}
