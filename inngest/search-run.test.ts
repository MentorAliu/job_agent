import { BadRequestError } from "@anthropic-ai/sdk";
import type { Usage } from "@anthropic-ai/sdk/resources/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { job } from "@/db/schema";
import type { CliOutcome } from "@/lib/claude/cli/run";
import { CliEngineError, type CliTask } from "@/lib/claude/cli/task";
import type { SearchScope } from "@/lib/claude/discover";
import type { JobToScore } from "@/lib/claude/score";
import type { AtsBoard, BoardPosting } from "@/lib/jobs/ats";
import { postingLink, type PostingLink } from "@/lib/jobs/canonical-url";
import type { FeedId, FeedPosting } from "@/lib/jobs/feeds";
import { addDays, dayIn } from "@/lib/jobs/today";
import {
  emptyRunStats,
  type JobFacts,
  type RunCounter,
  type RunStage,
  type RunStats,
  type RunStatus,
} from "@/lib/schemas/job";
import {
  cvExtractionSchema,
  toMasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_SEARCH_DOMAINS,
  type CliEngine,
} from "@/lib/schemas/settings";
import cv from "@/test/fixtures/claude/parse-cv-response.json";
import { samplePreferences } from "@/test/sample-preferences";

// The search run end to end, with the database and Claude replaced by an
// in-memory store and made-up postings. The eligibility check, dedupe keys
// and budget checks are the real ones.

type StoredJob = typeof job.$inferInsert & {
  id: string;
  score: number | null;
  scoreReasons: { reasons: string[]; gaps: string[] } | null;
};
type StoredRun = { status: RunStatus; stats: RunStats; costUsd: number };
type RuledOut = { id: string; reasons: string[] };

const store = {
  runs: new Map<string, StoredRun>(),
  jobs: [] as StoredJob[],
  calls: [] as { runId?: string | null; costUsd: number; stage: string }[],
  batches: new Map<string, JobToScore[]>(),
  /** Links read but not stored, and whether the next run tries once more. */
  seen: new Map<string, { tryAgain: boolean; firstRunId: string }>(),
  runBudgetUsd: 1,
  /** Counter writes that fail once, before they apply. */
  failingWrites: new Set<RunCounter>(),
  /** Roles found earlier that a run's re-check moved to Not eligible. */
  ruledOut: [] as RuledOut[],
  /** What the open-web search finds, or the error the API answers it with. */
  webResults: [] as string[],
  webError: null as Error | null,
  /** Every link read, in order, and the most read at once. */
  reads: [] as string[],
  reading: 0,
  mostReadAtOnce: 0,
  /** What each company board's API lists, by board key. */
  boards: new Map<string, BoardPosting[]>(),
  /** The posting dates the employers' systems give, by link. */
  listingDates: new Map<string, string>(),
  /** The command-line agent Settings picked, if any. */
  engine: null as CliEngine | null,
  /** Every scoring task the agent got, in order. */
  cliTasks: [] as CliTask[],
  /** Companies whose postings the agent gives no answer for. */
  cliUnanswered: new Set<string>(),
  /** The plan's limit is reached, so the agent answers nothing. */
  cliAtLimit: false,
  /** What each job board's feed answers; a feed left out can't be read. */
  feeds: new Map<FeedId, FeedPosting[]>(),
  /** Each time a feed was asked for, in order. */
  feedFetches: [] as FeedId[],
  /** The feed postings kept for reading, and when each feed was last asked. */
  feedRows: new Map<string, FeedPosting>(),
  feedChecks: new Map<FeedId, { at: Date; ok: boolean }>(),
  /** The links read from a feed's text rather than fetched. */
  textReads: [] as string[],
  /** Each discover call's scope, in order. */
  scopes: [] as SearchScope[],
  /** Roles a change to the profile has the next run score again. */
  rescoreIds: [] as string[],
};

/** A database write that fails the first time it touches `counts`. */
function failOnce(counts: Partial<Record<RunCounter, number>>) {
  for (const key of Object.keys(counts) as RunCounter[]) {
    if (store.failingWrites.delete(key)) {
      throw new Error(`Write of ${key} failed.`);
    }
  }
}

const profile = toMasterProfile(
  cvExtractionSchema.parse(
    JSON.parse((cv.body.content[0] as { text: string }).text),
  ),
);
const preferences: Preferences = {
  ...samplePreferences,
  stack: ["React", "TypeScript", "Node.js"],
  seniority: ["senior"],
  excludedCompanies: ["Globex"],
};

// ---------------------------------------------------------------------------
// Made-up postings, by link
// ---------------------------------------------------------------------------

type Posting = {
  company: string;
  title: string;
  quote: string;
  allowed: string[];
  workplace?: JobFacts["location"]["workplace"];
  /** The day the page says it was posted. */
  posted?: string;
};
const posting = (
  company: string,
  title: string,
  quote: string,
  allowed: string[],
  workplace?: JobFacts["location"]["workplace"],
): Posting => ({ company, title, quote, allowed, workplace });

// The owner's time zone, as setup saved it.
const TIME_ZONE = "Europe/Belgrade";
const TODAY = dayIn(TIME_ZONE);

const UUID = (n: number) =>
  `3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a${String(n).padStart(2, "0")}`;
const POSTINGS: Record<string, Posting | "not a posting" | "unreachable"> = {
  "https://boards.greenhouse.io/northwind/jobs/1001": posting(
    "Northwind Labs",
    "Senior Frontend Engineer",
    "Remote, anywhere in Europe.",
    ["Europe"],
  ),
  [`https://jobs.lever.co/blueharbor/${UUID(2)}`]: posting(
    "Blue Harbor",
    "Full-stack Engineer",
    "Open to candidates across EMEA.",
    ["EMEA"],
  ),
  [`https://jobs.ashbyhq.com/pixelforge/${UUID(3)}`]: posting(
    "Pixel Forge",
    "Backend Engineer",
    "Work from anywhere: we're fully remote worldwide.",
    ["Worldwide"],
  ),
  "https://apply.workable.com/fjord/j/A1B2C3D4E5": posting(
    "Fjord Apps",
    "React Developer",
    "",
    [],
  ),
  "https://boards.greenhouse.io/atlas/jobs/1005": posting(
    "Atlas Freight",
    "Senior Engineer",
    "Remote (US only).",
    ["United States"],
  ),
  "https://jobs.smartrecruiters.com/Kestrel/744000012345606-typescript-engineer":
    posting(
      "Kestrel Data",
      "TypeScript Engineer",
      "This role is remote, EU only.",
      ["EU"],
    ),
  "https://lumen.recruitee.com/o/frontend-engineer": posting(
    "Lumen Health",
    "Frontend Engineer",
    "",
    [],
  ),
  "https://weworkremotely.com/remote-jobs/orbit-senior-react-developer":
    posting("Orbit Studio", "Senior React Developer", "Remote in Europe.", [
      "Europe",
    ]),
  // The Northwind posting again, on a job board.
  "https://remotive.com/remote-jobs/software-dev/northwind-senior-frontend-engineer-9":
    posting(
      "Northwind Labs",
      "Senior Frontend Engineer",
      "Remote, anywhere in Europe.",
      ["Europe"],
    ),
  "https://remotive.com/remote-jobs/software-dev/cedar-node-engineer-10":
    posting("Cedar Pay", "Node.js Engineer", "Remote across the Balkans.", [
      "Balkans",
    ]),
  "https://remoteok.com/remote-jobs/quill-full-stack-developer-11": posting(
    "Quill Docs",
    "Full-stack Developer",
    "Anywhere in the world.",
    ["Worldwide"],
  ),
  "https://himalayas.app/companies/harbor-point/jobs/frontend-lead": posting(
    "Harbor Point",
    "Frontend Lead",
    "Remote within Europe.",
    ["Europe"],
  ),
  "https://www.workingnomads.com/jobs/mosaic-senior-engineer": posting(
    "Mosaic Labs",
    "Senior Engineer",
    "Hiring in the Western Balkans.",
    ["Western Balkans"],
  ),
  "https://landing.jobs/at/acme/all-jobs": "not a posting",
  "https://remoteok.com/remote-jobs/globex-react-engineer-15": posting(
    "Globex",
    "React Engineer",
    "Remote in Europe.",
    ["Europe"],
  ),
};
const LIST_PAGE = "https://boards.greenhouse.io/northwind";

/** What each job-site discover call finds, by its domains. */
function searchResults(domains: string[]): string[] {
  const links = Object.keys(POSTINGS).filter((url) => {
    const host = new URL(url).hostname;
    return domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  });
  return domains.includes("greenhouse.io") ? [LIST_PAGE, ...links] : links;
}

function factsFor(item: Posting, url: string): JobFacts {
  const fjord = url.includes("workable");
  return {
    company: item.company,
    title: item.title,
    summary: `${item.title} at ${item.company}.`,
    location: {
      workplace: item.workplace ?? "remote",
      quote: item.quote,
      allowed: item.allowed,
      placesAre: "required",
      excluded: [],
    },
    timeZones: fjord
      ? {
          quote: "You work within CET ±2 hours.",
          utcOffsetMin: -1,
          utcOffsetMax: 3,
        }
      : { quote: "", utcOffsetMin: null, utcOffsetMax: null },
    salary: {
      quote: "",
      min: null,
      max: null,
      currency: "",
      period: "unclear",
    },
    stack: ["React", "TypeScript"],
    seniority: "senior",
    contract: "full_time",
    deadline: "",
    applyUrl: "",
    requirements: ["5+ years of TypeScript"],
    applicationRules: [],
    aiPolicy: "",
  };
}

const USAGE = {
  input_tokens: 3000,
  output_tokens: 200,
  service_tier: "batch",
} as Usage;

// ---------------------------------------------------------------------------
// Mocks: the database, and Claude calls that spend from the store
// ---------------------------------------------------------------------------

vi.mock("@/lib/pipeline/setup", () => ({
  readOwnerTimeZone: async () => TIME_ZONE,
}));

vi.mock("@/lib/pipeline/budget", () => ({
  getBudgetLimits: async () => ({ monthlyUsd: 20, runUsd: store.runBudgetUsd }),
  getMonthSpendUsd: async () =>
    store.calls.reduce((sum, call) => sum + call.costUsd, 0),
  getRunSpendUsd: async (runId: string) =>
    store.calls
      .filter((call) => call.runId === runId)
      .reduce((sum, call) => sum + call.costUsd, 0),
}));

vi.mock("@/lib/pipeline/runs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pipeline/runs")>(
    "@/lib/pipeline/runs",
  );
  return {
    searchReadiness: actual.searchReadiness,
    getSearchInputs: async () => ({
      profile,
      preferences,
      domains: DEFAULT_SEARCH_DOMAINS,
      dailyRunEnabled: true,
    }),
    getRunStatus: async (runId: string) => {
      const run = store.runs.get(runId);
      return run ? { status: run.status, trigger: "manual" } : null;
    },
    updateRunStats: async (
      runId: string,
      counts: Partial<Record<RunCounter, number>>,
      stage?: RunStage,
    ) => {
      failOnce(counts);
      const run = store.runs.get(runId);
      if (!run || run.status !== "running") return;
      for (const [key, value] of Object.entries(counts)) {
        run.stats[key as RunCounter] += value ?? 0;
      }
      if (stage) run.stats.stage = stage;
    },
    setRunCounts: async (
      runId: string,
      counts: Partial<Record<RunCounter, number>>,
      stage?: RunStage,
    ) => {
      failOnce(counts);
      const run = store.runs.get(runId);
      if (!run || run.status !== "running") return;
      Object.assign(run.stats, counts, stage ? { stage } : {});
    },
    endRun: async (runId: string, status: RunStatus, stopReason?: string) => {
      const run = store.runs.get(runId);
      if (!run || run.status !== "running") return;
      run.status = status;
      run.stats = {
        ...run.stats,
        stage: "done",
        ...(stopReason ? { stopReason } : {}),
      };
      run.costUsd = store.calls
        .filter((call) => call.runId === runId)
        .reduce((sum, call) => sum + call.costUsd, 0);
    },
  };
});

vi.mock("@/lib/pipeline/jobs", () => ({
  unseenLinks: async (links: PostingLink[]) =>
    links.filter(
      (link) =>
        store.seen.get(link.dedupeKey)?.tryAgain !== false &&
        !store.jobs.some((stored) => stored.dedupeKey === link.dedupeKey),
    ),
  recordSeenLink: async (
    link: PostingLink,
    _reason: string,
    runId: string,
    { mayPass = false }: { mayPass?: boolean } = {},
  ) => {
    const existing = store.seen.get(link.dedupeKey);
    store.seen.set(link.dedupeKey, {
      tryAgain: mayPass && (!existing || existing.firstRunId === runId),
      firstRunId: existing?.firstRunId ?? runId,
    });
  },
  insertJob: async (values: typeof job.$inferInsert) => {
    const existing = store.jobs.find(
      (stored) =>
        stored.dedupeKey === values.dedupeKey ||
        (values.contentKey && stored.contentKey === values.contentKey),
    );
    if (existing) {
      // A retried step finds what its first try stored.
      return existing.dedupeKey === values.dedupeKey &&
        existing.firstRunId === values.firstRunId
        ? "saved"
        : "duplicate";
    }
    store.jobs.push({
      ...values,
      id: crypto.randomUUID(),
      score: null,
      scoreReasons: null,
    });
    return "saved";
  },
  getJobsToScore: async (limit: number, ids?: string[]) =>
    store.jobs
      .filter(
        (stored) =>
          (!ids || ids.includes(stored.id)) &&
          stored.score === null &&
          stored.status === "new" &&
          (stored.eligibility === "eligible" ||
            stored.eligibility === "unclear"),
      )
      .slice(0, limit)
      .map((stored) => ({
        id: stored.id,
        title: stored.title,
        company: stored.company,
        facts: stored.facts as JobFacts,
        eligibility: stored.eligibility,
        eligibilityReasons: stored.eligibilityReasons ?? [],
      })),
  saveScore: async (
    jobId: string,
    score: { score: number; reasons: string[]; gaps: string[] },
    call: { runId?: string; costUsd: number; stage: string },
  ) => {
    const stored = store.jobs.find((entry) => entry.id === jobId);
    if (!stored || stored.score !== null) return false;
    stored.score = score.score;
    stored.scoreReasons = { reasons: score.reasons, gaps: score.gaps };
    store.calls.push(call);
    return true;
  },
  recordBatchCall: async (call: {
    runId?: string;
    costUsd: number;
    stage: string;
  }) => {
    store.calls.push(call);
  },
}));

vi.mock("@/lib/pipeline/boards", () => ({
  // Newest first, as the database lists them.
  getEligibleRoleLinks: async () =>
    store.jobs
      .filter((stored) => stored.eligibility === "eligible")
      .map((stored) => ({
        canonicalUrl: stored.canonicalUrl,
        applyUrl: stored.applyUrl ?? null,
        company: stored.company,
      }))
      .reverse(),
}));

vi.mock("@/lib/jobs/boards", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/jobs/boards")>(
      "@/lib/jobs/boards",
    );
  const { boardKey } =
    await vi.importActual<typeof import("@/lib/jobs/ats")>("@/lib/jobs/ats");
  return {
    ...actual,
    fetchBoardPostings: async (board: AtsBoard) =>
      store.boards.get(boardKey(board)) ?? null,
  };
});

vi.mock("@/lib/jobs/feeds", async () => ({
  ...(await vi.importActual<object>("@/lib/jobs/feeds")),
  fetchFeed: async (id: FeedId) => {
    store.feedFetches.push(id);
    return store.feeds.get(id) ?? null;
  },
}));

vi.mock("@/lib/pipeline/feeds", () => ({
  recentFeedChecks: async (now: Date) =>
    [...store.feedChecks]
      .filter(([, check]) => now.getTime() - check.at.getTime() < 3_600_000)
      .map(([feed, check]) => ({ feed, ok: check.ok })),
  saveFeedCheck: async (
    feed: FeedId,
    postings: FeedPosting[] | null,
    now: Date,
  ) => {
    if (postings) {
      for (const [key, row] of store.feedRows) {
        if (row.feed === feed) store.feedRows.delete(key);
      }
      for (const row of postings) {
        const key = postingLink(row.url)?.dedupeKey;
        if (key) store.feedRows.set(key, row);
      }
    }
    store.feedChecks.set(feed, { at: now, ok: postings !== null });
  },
  getFeedListings: async (feeds: FeedId[]) =>
    [...store.feedRows.values()]
      .filter((row) => feeds.includes(row.feed))
      .map((row) => ({ ...row, url: postingLink(row.url)!.canonicalUrl })),
  getFeedPosting: async (dedupeKey: string) => {
    const row = store.feedRows.get(dedupeKey);
    return row ? { text: row.text, applyUrl: row.applyUrl } : null;
  },
}));

vi.mock("@/lib/jobs/listing-check", () => ({
  checkListing: async (listing: { canonicalUrl: string }) => {
    const postedOn = store.listingDates.get(listing.canonicalUrl);
    return {
      verdict: "open",
      fromAts: postedOn !== undefined,
      reason: "",
      ...(postedOn ? { postedOn } : {}),
    };
  },
}));

const UNSENT = ["new", "shortlisted", "ready"];

vi.mock("@/lib/pipeline/listings", () => ({
  getUnsentRoles: async () =>
    store.jobs
      .filter((stored) => UNSENT.includes(stored.status ?? "new"))
      .map((stored) => ({
        id: stored.id,
        facts: stored.facts as JobFacts,
        descriptionMd: stored.descriptionMd ?? null,
      })),
  markNotEligible: async (
    jobId: string,
    verdict: { quote: string; reasons: string[] },
  ) => {
    const stored = store.jobs.find((entry) => entry.id === jobId);
    if (!stored || !UNSENT.includes(stored.status ?? "new")) return false;
    Object.assign(stored, {
      status: "not_eligible",
      eligibility: "not_eligible",
      eligibilityQuote: verdict.quote || null,
      eligibilityReasons: verdict.reasons,
    });
    store.ruledOut.push({ id: jobId, reasons: verdict.reasons });
    return true;
  },
}));

vi.mock("@/lib/pipeline/rescore", () => ({
  rescoreIfProfileChanged: async () => {
    const roles = store.jobs.filter((stored) =>
      store.rescoreIds.includes(stored.id),
    );
    for (const stored of roles) {
      Object.assign(stored, { status: "new", score: null, scoreReasons: null });
    }
    store.rescoreIds = [];
    return { changed: roles.length > 0, rescored: roles.length };
  },
}));

vi.mock("@/lib/claude/llm-call", async () => ({
  ...(await vi.importActual<object>("@/lib/claude/llm-call")),
  getStageSetup: async (stage: string, model?: string) => ({
    stage,
    model: model ?? "claude-haiku-5-5",
    price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
    webSearchPer1k: 10,
    ...(store.engine ? { engine: store.engine } : {}),
  }),
}));

vi.mock("@/lib/pipeline/engine-state", () => ({
  noteEngineIssue: async () => {},
  readOpenAiKey: async () => null,
  readClaudeApiKey: async () => process.env.ANTHROPIC_API_KEY?.trim() || null,
}));

vi.mock("@/lib/claude/cli/run", () => ({
  runCliTasks: async (
    engine: CliEngine,
    tasks: CliTask[],
  ): Promise<CliOutcome[]> => {
    store.cliTasks.push(...tasks);
    return tasks.map((task): CliOutcome => {
      if (store.cliAtLimit) {
        return {
          ok: false,
          error: new CliEngineError(engine, "limit", "Limit reached."),
        };
      }
      if ([...store.cliUnanswered].some((name) => task.prompt.includes(name))) {
        return {
          ok: false,
          error: new CliEngineError(engine, "failed", "No answer."),
        };
      }
      return {
        ok: true,
        reply: {
          output: {
            focus: "frontend",
            reasons: ["Your React work matches the role."],
            gaps: [],
            score: 91,
          },
          usage: { ...USAGE, service_tier: "standard" },
          model: "claude-haiku-5-5",
          requestId: "session-1",
          webSearches: 0,
        },
      };
    });
  },
}));

const { assertWithinBudget } = await import("@/lib/claude/budget");

vi.mock("@/lib/claude/discover", async () => ({
  ...(await vi.importActual<object>("@/lib/claude/discover")),
  discoverPostings: async (
    _criteria: unknown,
    scope: SearchScope,
    runId: string,
  ) => {
    await assertWithinBudget(0.035, runId);
    store.scopes.push(scope);
    if (scope.kind === "web" && store.webError) throw store.webError;
    store.calls.push({ runId, costUsd: 0.031, stage: "discover" });
    const urls =
      scope.kind === "sites" ? searchResults(scope.domains) : store.webResults;
    return { urls, searches: 3, costUsd: 0.031 };
  },
}));

vi.mock("@/lib/claude/extract", () => ({
  readPosting: async (url: string, runId: string) => {
    store.mostReadAtOnce = Math.max(store.mostReadAtOnce, ++store.reading);
    try {
      return await readMadeUpPosting(url, runId);
    } finally {
      store.reading--;
    }
  },
  // A feed's text says what its made-up page says.
  readPostingText: async (url: string, text: string, runId: string) => {
    if (!text) throw new Error(`No text for ${url}`);
    store.textReads.push(url);
    return readMadeUpPosting(url, runId);
  },
}));

/** What the made-up page at `url` reads as. */
async function readMadeUpPosting(url: string, runId: string) {
  await assertWithinBudget(0.003, runId);
  store.reads.push(url);
  store.calls.push({ runId, costUsd: 0.0006, stage: "extract" });
  // The pipeline reads the canonical link, e.g. without "www.".
  const found = Object.keys(POSTINGS).find(
    (key) => postingLink(key)?.canonicalUrl === url,
  );
  const item = found && POSTINGS[found];
  if (!item) throw new Error(`No made-up posting at ${url}`);
  if (item === "not a posting") {
    return {
      kind: "skipped",
      reason: "The page isn't an open job posting.",
      final: true,
      costUsd: 0.0006,
    };
  }
  if (item === "unreachable") {
    return {
      kind: "skipped",
      reason: "The page couldn't be read (url_not_accessible).",
      final: false,
      costUsd: 0.0006,
    };
  }
  const facts = factsFor(item, url);
  const pageText = `${item.title}\n${item.company}\n${item.quote}\n${facts.timeZones.quote}`;
  return {
    kind: "posting",
    facts,
    postedOn: item.posted ?? null,
    pageText,
    costUsd: 0.0006,
  };
}

vi.mock("@/lib/claude/score", async () => ({
  ...(await vi.importActual<object>("@/lib/claude/score")),
  scoreEstimateUsd: () => 0.001,
  submitScoreBatch: async (_profile: string, jobs: JobToScore[]) => {
    const id = `msgbatch_${store.batches.size + 1}`;
    store.batches.set(id, jobs);
    return id;
  },
  getScoreBatchProgress: vi.fn(async () => ({
    ended: true,
    succeeded: 0,
    errored: 0,
    processing: 0,
  })),
  readScoreBatch: async function* (batchId: string) {
    for (const scored of store.batches.get(batchId) ?? []) {
      yield {
        jobId: scored.id,
        kind: "scored",
        score: {
          focus: "frontend",
          reasons: [`Your TypeScript work matches ${scored.title}.`],
          gaps: ["No logistics experience shown."],
          score: scored.eligibility === "eligible" ? 82 : 55,
        },
        usage: USAGE,
      };
    }
  },
}));

const {
  runSearch,
  withoutSites,
  ENOUGH_MATCHES,
  groupsToSearch,
  interleave,
  MAX_SCORE_POLLS,
  MAX_SITE_GROUPS,
  scorePollDelay,
} = await import("./search-run");
const score = await import("@/lib/claude/score");

/** A stand-in for Inngest's step tools: runs each step once, JSON round trip included. */
function fakeStep(retries = 0) {
  const ids: string[] = [];
  const claim = (id: string) => {
    if (ids.includes(id)) throw new Error(`Step id ${id} used twice.`);
    ids.push(id);
  };
  const step = {
    run: async (id: string, fn: () => unknown) => {
      claim(id);
      for (let attempt = 0; ; attempt++) {
        try {
          const value = await fn();
          return value === undefined ? null : JSON.parse(JSON.stringify(value));
        } catch (error) {
          if (attempt >= retries) throw error;
        }
      }
    },
    sleep: async (id: string) => claim(id),
  };
  return { step: step as unknown as Parameters<typeof runSearch>[1], ids };
}

/** Runs `fn` with more made-up postings online, then takes them down. */
async function withPostings(
  extra: Record<string, Posting | "unreachable">,
  fn: () => Promise<void>,
) {
  Object.assign(POSTINGS, extra);
  try {
    await fn();
  } finally {
    for (const url of Object.keys(extra)) delete POSTINGS[url];
  }
}

function newRun(): string {
  const id = crypto.randomUUID();
  store.runs.set(id, {
    status: "running",
    stats: emptyRunStats("queued"),
    costUsd: 0,
  });
  return id;
}

describe("runSearch (steps 2–6)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    store.runs.clear();
    store.jobs = [];
    store.seen.clear();
    store.failingWrites.clear();
    store.calls = [];
    store.batches.clear();
    store.runBudgetUsd = 1;
    store.ruledOut = [];
    store.webResults = [];
    store.webError = null;
    store.reads = [];
    store.boards.clear();
    store.listingDates.clear();
    store.engine = null;
    store.cliTasks = [];
    store.cliUnanswered.clear();
    store.cliAtLimit = false;
    store.mostReadAtOnce = 0;
    store.feeds.clear();
    store.feedFetches = [];
    store.feedRows.clear();
    store.feedChecks.clear();
    store.textReads = [];
    store.scopes = [];
    store.rescoreIds = [];
  });

  it("stores at least 10 postings, each with facts, a quoted verdict and a scored match", async () => {
    const runId = newRun();
    const { step, ids } = fakeStep();
    expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

    const run = store.runs.get(runId);
    expect(run).toMatchObject({
      status: "succeeded",
      stats: {
        stage: "done",
        // No roles yet, so no company boards to check.
        boards: 0,
        boardPostings: 0,
        searches: 12,
        found: 15,
        fresh: 15,
        toRead: 15,
        read: 15,
        duplicates: 1,
        skipped: 1,
        toScore: 10,
        scoreFailed: 0,
      },
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        "start",
        "recheck-roles",
        "check-boards",
        "discover-1",
        "discover-2",
        "discover-3",
        "discover-web",
        "read-15",
        "score-submit",
        "score-save",
        "finish",
      ]),
    );

    const saved = store.jobs.filter((stored) => stored.firstRunId === runId);
    expect(saved).toHaveLength(13);
    for (const stored of saved) {
      expect(stored.facts, stored.title).toBeTruthy();
      expect(stored.eligibility).toMatch(/eligible|unclear/);
      expect(stored.eligibilityReasons?.length).toBeGreaterThan(0);
    }

    // Eligible and unclear postings get a score with reasons; each verdict
    // that rests on a rule quotes the posting.
    const scored = saved.filter((stored) => stored.score !== null);
    expect(scored.length).toBeGreaterThanOrEqual(10);
    for (const stored of scored) {
      expect(stored.scoreReasons?.reasons.length).toBeGreaterThan(0);
    }
    const byCompany = (company: string) =>
      saved.find((stored) => stored.company === company);
    expect(byCompany("Northwind Labs")).toMatchObject({
      eligibility: "eligible",
      eligibilityQuote: "Remote, anywhere in Europe.",
      status: "new",
      score: 82,
    });
    expect(byCompany("Fjord Apps")).toMatchObject({
      eligibility: "eligible",
      eligibilityQuote: "You work within CET ±2 hours.",
    });
    expect(byCompany("Atlas Freight")).toMatchObject({
      eligibility: "not_eligible",
      eligibilityQuote: "Remote (US only).",
      status: "not_eligible",
      score: null,
    });
    expect(byCompany("Kestrel Data")).toMatchObject({
      eligibility: "not_eligible",
    });
    expect(byCompany("Lumen Health")).toMatchObject({
      eligibility: "unclear",
      score: 55,
    });
    expect(byCompany("Globex")).toMatchObject({
      status: "skipped",
      score: null,
    });

    // Every call is costed against the run, the scores at batch prices.
    expect(run?.costUsd).toBeGreaterThan(0.1);
    expect(store.calls.filter((call) => call.stage === "score")).toHaveLength(
      10,
    );
  });

  it("scores on the command-line agent at $0, and sends only what it can't score to the batch", async () => {
    store.engine = "claude_code";
    store.cliUnanswered.add("Lumen Health");
    const runId = newRun();
    const { step, ids } = fakeStep();
    expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

    // Ten to score, four per step, in one sandbox each.
    expect(ids).toEqual(
      expect.arrayContaining(["score-cli-plan", "score-cli-1", "score-cli-3"]),
    );
    expect(ids).not.toContain("score-cli-4");
    expect(store.cliTasks).toHaveLength(10);
    // Claude Code's token serves many steps at once.
    expect(store.mostReadAtOnce).toBeGreaterThan(1);
    expect(store.cliTasks[0]).toMatchObject({
      stage: "score",
      model: "claude-haiku-5-5",
      system: expect.stringContaining("Stack: React, TypeScript, Node.js"),
    });

    const saved = store.jobs.filter((stored) => stored.firstRunId === runId);
    const byCompany = (company: string) =>
      saved.find((stored) => stored.company === company);
    expect(byCompany("Northwind Labs")?.score).toBe(91);
    // The one the agent couldn't score went to the batch, on the API.
    expect(byCompany("Lumen Health")?.score).toBe(55);
    expect(
      [...store.batches.values()].flat().map((job) => job.company),
    ).toEqual(["Lumen Health"]);
    const scores = store.calls.filter((call) => call.stage === "score");
    expect(scores).toHaveLength(10);
    expect(scores.filter((call) => call.costUsd === 0)).toHaveLength(9);
  });

  it("without an API key, leaves what the agent couldn't score for the next run", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    store.engine = "claude_code";
    store.cliUnanswered.add("Lumen Health");
    const runId = newRun();
    const outcome = await runSearch(runId, fakeStep().step);

    const reason =
      "1 posting waits for the next run. Claude Code couldn't run this step, and there's no API key to run it on instead. Settings, under Agents run on, says why.";
    expect(outcome).toEqual({ status: "stopped", stopReason: reason });
    expect(store.batches.size).toBe(0);
    const lumen = store.jobs.find(
      (stored) =>
        stored.firstRunId === runId && stored.company === "Lumen Health",
    );
    expect(lumen?.score).toBeNull();
  });

  it("sends every posting to the batch once the plan's limit is reached", async () => {
    store.engine = "claude_code";
    store.cliAtLimit = true;
    const { step, ids } = fakeStep();
    await runSearch(newRun(), step);

    // One sandbox finds out, and the rest aren't tried.
    expect(ids).toContain("score-cli-1");
    expect(ids).not.toContain("score-cli-2");
    expect([...store.batches.values()].flat()).toHaveLength(10);
  });

  it("reads one posting at a time on Codex, since its sign-in serves one step at a time", async () => {
    store.engine = "codex";
    await runSearch(newRun(), fakeStep().step);
    expect(store.mostReadAtOnce).toBe(1);
    expect(store.cliTasks).toHaveLength(10);
  });

  it("reads new postings at companies that posted a role the owner can take, first", async () => {
    await runSearch(newRun(), fakeStep().step);

    const design = "https://job-boards.greenhouse.io/northwind/jobs/1101";
    const fullStack = `https://jobs.lever.co/blueharbor/${UUID(52)}`;
    const listed = (
      id: string,
      title: string,
      url: string,
      postedOn: string | null,
      remote: boolean | null = true,
    ): BoardPosting => ({ id, title, url, postedOn, remote });
    store.boards.set("greenhouse:northwind", [
      // Stored by the first run.
      listed(
        "1001",
        "Senior Frontend Engineer",
        "https://boards.greenhouse.io/northwind/jobs/1001",
        addDays(TODAY, -9),
      ),
      listed(
        "1101",
        "Senior Frontend Engineer, Design Systems",
        design,
        addDays(TODAY, -1),
        null,
      ),
      // Not a frontend or full-stack role, too old, or too junior.
      listed(
        "1102",
        "Backend Engineer",
        "https://job-boards.greenhouse.io/northwind/jobs/1102",
        TODAY,
      ),
      listed(
        "1103",
        "Frontend Engineer",
        "https://job-boards.greenhouse.io/northwind/jobs/1103",
        addDays(TODAY, -40),
      ),
      listed(
        "1104",
        "Junior Frontend Developer",
        "https://job-boards.greenhouse.io/northwind/jobs/1104",
        TODAY,
      ),
    ]);
    store.boards.set("lever:blueharbor", [
      // The board says hybrid.
      listed(
        UUID(51),
        "React Engineer",
        `https://jobs.lever.co/blueharbor/${UUID(51)}`,
        TODAY,
        false,
      ),
      listed(UUID(52), "Full-stack Engineer", fullStack, TODAY),
    ]);
    const extra = {
      [design]: posting(
        "Northwind Labs",
        "Senior Frontend Engineer, Design Systems",
        "Remote, anywhere in Europe.",
        ["Europe"],
      ),
      [fullStack]: posting(
        "Blue Harbor",
        "Full-stack Engineer",
        "Open to candidates across EMEA.",
        ["EMEA"],
      ),
    };
    await withPostings(extra, async () => {
      store.reads = [];
      const runId = newRun();
      const { step, ids } = fakeStep();
      expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

      expect(ids.indexOf("check-boards")).toBeLessThan(
        ids.indexOf("discover-1"),
      );
      expect(store.runs.get(runId)?.stats).toMatchObject({
        // Northwind, Blue Harbor, Pixel Forge and Fjord Apps: the eligible
        // roles on a tracking system.
        boards: 4,
        boardPostings: 2,
        fresh: 0,
        read: 2,
      });
      // The frontend role before the full-stack one, though it's older.
      expect(store.reads).toEqual([design, fullStack]);
      expect(
        store.jobs.find((stored) => stored.canonicalUrl === design),
      ).toMatchObject({
        postedOn: addDays(TODAY, -1),
        eligibility: "eligible",
        score: 82,
      });
    });
  });

  it("reads the remote boards' feeds before searching, and leaves their sites out of the searches", async () => {
    const react =
      "https://remoteOK.com/remote-jobs/remote-senior-react-engineer-tern-1137601";
    const vue =
      "https://weworkremotely.com/remote-jobs/lattice-senior-vue-developer";
    const usOnly =
      "https://remoteok.com/remote-jobs/remote-frontend-engineer-ridge-1137602";
    const feedPosting = (
      feed: FeedId,
      url: string,
      title: string,
      company: string,
      places: string[],
      postedOn: string | null,
      applyUrl = url,
    ): FeedPosting => ({
      feed,
      url,
      applyUrl,
      title,
      company,
      places,
      postedOn,
      text: `Listed on a job board for remote work.\nTitle: ${title}\nCompany: ${company}`,
    });
    store.feeds.set("remoteok", [
      feedPosting(
        "remoteok",
        react,
        "Senior React Engineer",
        "Tern Health",
        ["Europe"],
        addDays(TODAY, -2),
      ),
      // Open only where the owner doesn't live, or not a developer's job.
      feedPosting(
        "remoteok",
        usOnly,
        "Frontend Engineer",
        "Ridge Pay",
        ["US"],
        TODAY,
      ),
      feedPosting(
        "remoteok",
        "https://remoteok.com/remote-jobs/remote-product-designer-tern-1137603",
        "Product Designer",
        "Tern Health",
        [],
        TODAY,
      ),
    ]);
    store.feeds.set("weworkremotely", [
      feedPosting(
        "weworkremotely",
        vue,
        "Senior Vue Developer",
        "Lattice Works",
        ["Anywhere in the World"],
        TODAY,
      ),
      // Too old for a kit.
      feedPosting(
        "weworkremotely",
        "https://weworkremotely.com/remote-jobs/lattice-frontend-developer",
        "Frontend Developer",
        "Lattice Works",
        [],
        addDays(TODAY, -30),
      ),
    ]);
    store.feeds.set("jobicy", []);
    const extra = {
      [react]: posting(
        "Tern Health",
        "Senior React Engineer",
        "Remote within Europe.",
        ["Europe"],
      ),
      [vue]: posting(
        "Lattice Works",
        "Senior Vue Developer",
        "Anywhere in the world.",
        ["Worldwide"],
      ),
    };
    await withPostings(extra, async () => {
      const runId = newRun();
      const { step, ids } = fakeStep();
      expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

      expect(ids.indexOf("check-feeds")).toBeGreaterThan(
        ids.indexOf("check-boards"),
      );
      expect(ids.indexOf("check-feeds")).toBeLessThan(
        ids.indexOf("discover-1"),
      );
      // Himalayas' feed couldn't be read, so its site is still searched.
      expect(store.runs.get(runId)?.stats).toMatchObject({
        feeds: 3,
        feedPostings: 2,
      });
      const searched = store.scopes.flatMap((scope) =>
        scope.kind === "sites" ? scope.domains : [],
      );
      expect(searched).not.toContain("remoteok.com");
      expect(searched).not.toContain("weworkremotely.com");
      expect(searched).toContain("himalayas.app");
      expect(searched).toContain("greenhouse.io");
      expect(
        store.scopes.filter((scope) => scope.kind === "sites"),
      ).toHaveLength(3);
      const web = store.scopes.find((scope) => scope.kind === "web");
      expect(web?.kind === "web" && web.except).toContain("jobicy.com");

      // Read from the feeds' text, the newest first, and applied for on
      // the board.
      const reactUrl = postingLink(react)!.canonicalUrl;
      expect(store.textReads).toEqual([vue, reactUrl]);
      expect(
        store.jobs.find((stored) => stored.canonicalUrl === reactUrl),
      ).toMatchObject({
        applyUrl: react,
        postedOn: addDays(TODAY, -2),
        eligibility: "eligible",
        status: "new",
        score: 82,
      });
      expect(store.reads.join(" ")).not.toMatch(/ridge|designer/);
    });
  });

  it("asks each feed at most once an hour, and reads what it answered then", async () => {
    const react =
      "https://himalayas.app/companies/tern-health/jobs/senior-react-engineer";
    store.feeds.set("himalayas", [
      {
        feed: "himalayas",
        url: react,
        applyUrl: `${react}?utm_source=api`,
        title: "Senior React Engineer",
        company: "Tern Health",
        places: ["Montenegro", "Albania"],
        postedOn: TODAY,
        text: "Title: Senior React Engineer",
      },
    ]);
    const extra = {
      [react]: posting(
        "Tern Health",
        "Senior React Engineer",
        "Open to candidates in Montenegro and Albania.",
        ["Montenegro", "Albania"],
      ),
    };
    await withPostings(extra, async () => {
      // A run stopped by the budget before it read the posting.
      store.runBudgetUsd = 0.001;
      await runSearch(newRun(), fakeStep().step);
      expect(store.feedFetches.sort()).toEqual([
        "himalayas",
        "jobicy",
        "remoteok",
        "weworkremotely",
      ]);

      store.runBudgetUsd = 1;
      const runId = newRun();
      expect(await runSearch(runId, fakeStep().step)).toEqual({
        status: "succeeded",
      });
      // No feed asked again; the posting kept from the first answer is read.
      expect(store.feedFetches).toHaveLength(4);
      expect(store.textReads).toEqual([react]);
      expect(
        store.jobs.find((stored) => stored.canonicalUrl === react),
      ).toMatchObject({ applyUrl: `${react}?utm_source=api` });
      // Only Himalayas answered, so the other boards are searched.
      expect(store.runs.get(runId)?.stats).toMatchObject({ feeds: 1 });
    });
  });

  it("dates each posting from the employer's system, else from the page", async () => {
    const quoted =
      "https://weworkremotely.com/remote-jobs/dated-react-developer";
    const both = "https://weworkremotely.com/remote-jobs/both-react-developer";
    const blueHarbor = `https://jobs.lever.co/blueharbor/${UUID(2)}`;
    store.listingDates.set(blueHarbor, addDays(TODAY, -3));
    store.listingDates.set(both, addDays(TODAY, -12));
    const extra = {
      [quoted]: {
        ...posting("Dated Co", "React Developer", "Remote in Europe.", [
          "Europe",
        ]),
        posted: addDays(TODAY, -2),
      },
      [both]: {
        ...posting("Both Co", "React Developer", "Remote in Europe.", [
          "Europe",
        ]),
        posted: addDays(TODAY, -1),
      },
    };
    await withPostings(extra, async () => {
      await runSearch(newRun(), fakeStep().step);
      const postedOn = (company: string) =>
        store.jobs.find((stored) => stored.company === company)?.postedOn;
      expect(postedOn("Blue Harbor")).toBe(addDays(TODAY, -3));
      expect(postedOn("Dated Co")).toBe(addDays(TODAY, -2));
      // The employer's system over what the page says.
      expect(postedOn("Both Co")).toBe(addDays(TODAY, -12));
      expect(postedOn("Pixel Forge")).toBeNull();
    });
  });

  it("never scores a hybrid, on-site or unsaid role when the owner wants remote only", async () => {
    const extra = {
      "https://boards.greenhouse.io/delta/jobs/2001": posting(
        "Delta Bank",
        "Senior React Engineer",
        "Hybrid: two days a week in our Berlin office.",
        ["Germany"],
        "hybrid",
      ),
      "https://jobs.lever.co/ember/3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a77":
        posting(
          "Ember Retail",
          "Frontend Engineer",
          "Based in our Vienna office.",
          ["Austria"],
          "onsite",
        ),
      "https://jobs.ashbyhq.com/fable/3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a78":
        posting(
          "Fable Games",
          "TypeScript Engineer",
          "Open to candidates across Europe.",
          ["Europe"],
          "unclear",
        ),
    };
    await withPostings(extra, async () => {
      await runSearch(newRun(), fakeStep().step);
      for (const company of ["Delta Bank", "Ember Retail", "Fable Games"]) {
        const stored = store.jobs.find((entry) => entry.company === company);
        expect(stored, company).toMatchObject({
          eligibility: "not_eligible",
          status: "not_eligible",
          score: null,
        });
        expect(stored?.eligibilityReasons?.[0], company).toMatch(
          /you want remote work only/,
        );
      }
    });
  });

  it("re-checks the roles found earlier before it scores or picks", async () => {
    const earlier = (
      company: string,
      status: StoredJob["status"],
      workplace: JobFacts["location"]["workplace"],
    ): StoredJob => {
      const item = posting(
        company,
        "React Developer",
        "Remote in Europe.",
        ["Europe"],
        workplace,
      );
      const url = `https://remoteok.com/remote-jobs/${company.toLowerCase()}-react-developer-40`;
      return {
        id: crypto.randomUUID(),
        canonicalUrl: url,
        dedupeKey: url,
        company,
        title: item.title,
        descriptionMd: `${item.title}\n${company}\n${item.quote}`,
        facts: factsFor(item, url),
        eligibility: "eligible",
        status,
        score: null,
        scoreReasons: null,
      };
    };
    store.jobs = [
      // Saved before remote only was enforced, and not sent yet.
      earlier("Hybridco", "new", "hybrid"),
      earlier("Officely", "ready", "onsite"),
      earlier("Vague", "shortlisted", "unclear"),
      // Fully remote, or sent already: left as they are.
      earlier("Remotely", "ready", "remote"),
      earlier("Sentco", "applied", "hybrid"),
    ];
    const { step, ids } = fakeStep();
    await runSearch(newRun(), step);

    expect(ids.indexOf("recheck-roles")).toBeLessThan(
      ids.indexOf("score-submit"),
    );
    const byCompany = (company: string) =>
      store.jobs.find((entry) => entry.company === company);
    for (const company of ["Hybridco", "Officely", "Vague"]) {
      expect(byCompany(company), company).toMatchObject({
        status: "not_eligible",
        eligibility: "not_eligible",
        score: null,
      });
    }
    expect(store.ruledOut.map((entry) => entry.reasons[0])).toEqual([
      "The role is hybrid, and you want remote work only.",
      "The role is on-site, and you want remote work only.",
      "The posting doesn't say the role is remote, and you want remote work only.",
    ]);
    expect(byCompany("Remotely")?.status).toBe("ready");
    expect(byCompany("Sentco")?.status).toBe("applied");
  });

  it("scores the waiting and passed roles again after a profile change, with the new postings", async () => {
    const earlier = (
      company: string,
      status: StoredJob["status"],
      score: number,
    ): StoredJob => {
      const item = posting(
        company,
        "Full-stack Engineer",
        "Remote in Europe.",
        ["Europe"],
      );
      const url = `https://remoteok.com/remote-jobs/${company.toLowerCase()}-full-stack-engineer-41`;
      return {
        id: crypto.randomUUID(),
        canonicalUrl: url,
        dedupeKey: url,
        company,
        title: item.title,
        descriptionMd: `${item.title}\n${company}\n${item.quote}`,
        facts: factsFor(item, url),
        eligibility: "eligible",
        status,
        score,
        scoreReasons: { reasons: ["Old profile."], gaps: [] },
      };
    };
    const waiting = earlier("Waitwell", "new", 80);
    const passed = earlier("Passmore", "skipped", 60);
    store.jobs = [waiting, passed];
    store.rescoreIds = [waiting.id, passed.id];

    const runId = newRun();
    const { step, ids } = fakeStep();
    await runSearch(runId, step);

    expect(ids.indexOf("recheck-roles")).toBeLessThan(
      ids.indexOf("rescore-roles"),
    );
    expect(ids.indexOf("rescore-roles")).toBeLessThan(
      ids.indexOf("score-submit"),
    );
    for (const role of [waiting, passed]) {
      expect(role.status).toBe("new");
      expect(role.score).not.toBeNull();
      expect(role.scoreReasons?.reasons).not.toEqual(["Old profile."]);
    }
    expect(store.runs.get(runId)?.stats).toMatchObject({ rescored: 2 });
    // The new postings are scored in the same run.
    expect(
      store.jobs.filter(
        (stored) => stored.firstRunId === runId && stored.score !== null,
      ).length,
    ).toBeGreaterThanOrEqual(10);
  });

  it("scores nothing again when the profile didn't change", async () => {
    const runId = newRun();
    const { step } = fakeStep();
    await runSearch(runId, step);
    expect(store.runs.get(runId)?.stats?.rescored).toBeUndefined();
  });

  it("looks past the job sites for postings on employers' own careers pages", async () => {
    const careers = "https://careers.northstar.io/senior-react-engineer";
    const hybrid = "https://www.tidewater.com/careers/frontend-engineer";
    store.webResults = [
      careers,
      // Off limits: its terms forbid scraping.
      "https://www.linkedin.com/jobs/view/senior-react-engineer-at-acme-4012345",
      // Not about a job.
      "https://blog.example.com/2026/10/remote-work-tips",
      // Found by the job-site search already.
      "https://boards.greenhouse.io/northwind/jobs/1001?utm_source=search",
      hybrid,
    ];
    const extra = {
      [careers]: posting(
        "Northstar Health",
        "Senior React Engineer",
        "Fully remote, anywhere in Europe.",
        ["Europe"],
      ),
      [hybrid]: posting(
        "Tidewater Bank",
        "Frontend Engineer",
        "Three days a week in our Lisbon office.",
        ["Portugal"],
        "hybrid",
      ),
    };
    await withPostings(extra, async () => {
      const runId = newRun();
      const { step, ids } = fakeStep();
      expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

      expect(ids.indexOf("discover-web")).toBe(ids.indexOf("discover-3") + 1);
      expect(store.runs.get(runId)?.stats).toMatchObject({
        searches: 12,
        found: 17,
        fresh: 17,
      });
      expect(store.reads).toContain(careers);
      expect(store.reads).toContain(postingLink(hybrid)?.canonicalUrl);
      expect(store.reads.join(" ")).not.toMatch(/linkedin|blog\.example/);

      // The same remote and location checks as postings on the job sites.
      const byCompany = (company: string) =>
        store.jobs.find((entry) => entry.company === company);
      expect(byCompany("Northstar Health")).toMatchObject({
        canonicalUrl: careers,
        eligibility: "eligible",
        eligibilityQuote: "Fully remote, anywhere in Europe.",
        status: "new",
        score: 82,
      });
      expect(byCompany("Tidewater Bank")).toMatchObject({
        eligibility: "not_eligible",
        status: "not_eligible",
        score: null,
      });
      expect(byCompany("Tidewater Bank")?.eligibilityReasons?.[0]).toMatch(
        /you want remote work only/,
      );
    });
  });

  it("keeps the job sites' postings when the API rejects the open-web search", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.webError = new BadRequestError(
      400,
      {
        type: "error",
        error: { type: "invalid_request_error", message: "Bad domain." },
      },
      "Bad domain.",
      new Headers(),
    );
    try {
      const runId = newRun();
      expect(await runSearch(runId, fakeStep().step)).toEqual({
        status: "succeeded",
      });
      expect(store.runs.get(runId)?.stats).toMatchObject({
        searches: 9,
        found: 15,
        toScore: 10,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Open-web search skipped"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("adds no duplicates when a second run finds the same postings", async () => {
    await runSearch(newRun(), fakeStep().step);
    const before = store.jobs.map((stored) => stored.dedupeKey).sort();

    const second = newRun();
    expect(await runSearch(second, fakeStep().step)).toEqual({
      status: "succeeded",
    });

    expect(store.jobs.map((stored) => stored.dedupeKey).sort()).toEqual(before);
    expect(store.jobs.filter((stored) => stored.firstRunId === second)).toEqual(
      [],
    );
    expect(store.runs.get(second)?.stats).toMatchObject({
      found: 15,
      // The first run remembered the reposted Northwind link and the page
      // that isn't a posting, so nothing is read again.
      fresh: 0,
      toRead: 0,
      read: 0,
      duplicates: 0,
      skipped: 0,
      toScore: 0,
    });
    expect(new Set(store.jobs.map((stored) => stored.contentKey)).size).toBe(
      store.jobs.length,
    );
  });

  it("counts exactly and creates one batch when steps are retried", async () => {
    // A read's last write fails, and so does recording the batch size.
    store.failingWrites.add("read");
    store.failingWrites.add("toScore");
    const runId = newRun();
    expect(await runSearch(runId, fakeStep(1).step)).toEqual({
      status: "succeeded",
    });

    expect(store.failingWrites.size).toBe(0);
    expect(store.batches.size).toBe(1);
    expect(store.runs.get(runId)?.stats).toMatchObject({
      read: 15,
      duplicates: 1,
      skipped: 1,
      toScore: 10,
    });
    expect(store.jobs.filter((stored) => stored.score !== null)).toHaveLength(
      10,
    );
  });

  it("stops reading once it has enough matches to score", async () => {
    // 12 more matches on one board, so 22 in all.
    const extra = Object.fromEntries(
      Array.from({ length: 12 }, (_, n) => [
        `https://remoteok.com/remote-jobs/extra-react-developer-${n + 20}`,
        posting(`Extra ${n + 20}`, "React Developer", "Remote in Europe.", [
          "Europe",
        ]),
      ]),
    );
    await withPostings(extra, async () => {
      const runId = newRun();
      const { step, ids } = fakeStep();
      expect(await runSearch(runId, step)).toEqual({ status: "succeeded" });

      const stats = store.runs.get(runId)?.stats;
      expect(stats).toMatchObject({ found: 27, fresh: 27 });
      // Whole rounds of 5, stopping once 15 or more are matches.
      expect(stats?.read).toBeLessThan(27);
      expect((stats?.read ?? 0) % 5).toBe(0);
      expect(stats?.toRead).toBe(stats?.read);
      expect(stats?.toScore).toBeGreaterThanOrEqual(ENOUGH_MATCHES);
      expect(ids).not.toContain("read-27");
    });
  });

  it("reads the boards in turn, so one board can't take every slot", () => {
    expect(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "c2",
      "a3",
    ]);
  });

  it("searches every group, or a daily turn of them when there are many", () => {
    const groups = (count: number) =>
      Array.from({ length: count }, (_, n) => [`board${n + 1}.com`]);
    expect(groupsToSearch(groups(3))).toEqual(groups(3));

    const day = 86_400_000;
    const today = groupsToSearch(groups(10), 20_000 * day);
    const tomorrow = groupsToSearch(groups(10), 20_001 * day);
    // The open web takes the last discover call.
    expect(today).toHaveLength(MAX_SITE_GROUPS);
    expect(today.flat()).toEqual(["board1.com", "board2.com", "board3.com"]);
    expect(tomorrow.flat()[0]).toBe("board2.com");
  });

  it("spreads the sites left across the same number of searches", () => {
    const groups = [
      ["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com"],
      [
        "smartrecruiters.com",
        "recruitee.com",
        "weworkremotely.com",
        "remotive.com",
      ],
      ["remoteok.com", "himalayas.app", "workingnomads.com", "landing.jobs"],
    ];
    expect(withoutSites(groups, [])).toBe(groups);
    expect(
      withoutSites(groups, [
        "remoteok.com",
        "weworkremotely.com",
        "himalayas.app",
      ]),
    ).toEqual([
      ["greenhouse.io", "lever.co", "ashbyhq.com"],
      ["workable.com", "smartrecruiters.com", "recruitee.com"],
      ["remotive.com", "workingnomads.com", "landing.jobs"],
    ]);
    expect(
      withoutSites([["remoteok.com"], ["lever.co"]], ["remoteok.com"]),
    ).toEqual([["lever.co"]]);
    expect(withoutSites([["remoteok.com"]], ["remoteok.com"])).toEqual([]);
  });

  it("tries a page that couldn't be fetched once more, in the next run", async () => {
    const url = "https://remoteok.com/remote-jobs/blocked-node-developer-30";
    await withPostings({ [url]: "unreachable" }, async () => {
      const runs = [newRun(), newRun(), newRun()];
      for (const runId of runs) await runSearch(runId, fakeStep().step);

      const stats = runs.map((runId) => store.runs.get(runId)?.stats);
      expect(stats.map((entry) => entry?.fresh)).toEqual([16, 1, 0]);
      expect(stats.map((entry) => entry?.skipped)).toEqual([2, 1, 0]);
    });
  });

  it("keeps the next run's try when a failed read's step is retried", async () => {
    await runSearch(newRun(), fakeStep().step);
    const url = "https://remoteok.com/remote-jobs/blocked-node-developer-30";
    await withPostings({ [url]: "unreachable" }, async () => {
      // The only read is the blocked page. Its last write fails, so the
      // step runs, and fails to fetch, twice in the same run.
      store.failingWrites.add("read");
      await runSearch(newRun(), fakeStep(1).step);
      expect(store.failingWrites.size).toBe(0);

      const next = newRun();
      await runSearch(next, fakeStep().step);
      expect(store.runs.get(next)?.stats).toMatchObject({
        fresh: 1,
        skipped: 1,
      });
    });
  });

  it("stops at the per-run budget and records why", async () => {
    store.runBudgetUsd = 0.05;
    const runId = newRun();
    const outcome = await runSearch(runId, fakeStep().step);

    const reason =
      "Stopped at the $0.050 per-run budget set in Settings, after spending $0.031.";
    expect(outcome).toEqual({ status: "stopped", stopReason: reason });
    expect(store.runs.get(runId)).toMatchObject({
      status: "stopped",
      stats: { stage: "done", stopReason: reason },
    });
    // The second discover call never went out.
    expect(store.calls).toHaveLength(1);
  });

  it("scores only what the run budget still covers, and says so", async () => {
    // Discovery ($0.124) and reading ($0.009) fit; then room for 3 scores.
    store.runBudgetUsd = 0.1365;
    const runId = newRun();
    const outcome = await runSearch(runId, fakeStep().step);

    expect(outcome.status).toBe("stopped");
    expect(outcome.stopReason).toBe(
      "Stopped at the $0.14 per-run budget: scored 3 of 10 postings. The rest wait for the next run.",
    );
    expect(store.jobs.filter((stored) => stored.score !== null)).toHaveLength(
      3,
    );
  });

  it("waits for the batch, checking less often as time goes on", async () => {
    const progress = vi.mocked(score.getScoreBatchProgress);
    progress
      .mockResolvedValueOnce({
        ended: false,
        succeeded: 0,
        errored: 0,
        processing: 10,
      })
      .mockResolvedValueOnce({
        ended: false,
        succeeded: 4,
        errored: 0,
        processing: 6,
      });
    const { step, ids } = fakeStep();
    await runSearch(newRun(), step);

    expect(ids.filter((id) => id.startsWith("score-check-"))).toEqual([
      "score-check-1",
      "score-check-2",
      "score-check-3",
    ]);
    expect([1, 6, 7, 64, 65].map(scorePollDelay)).toEqual([
      "20s",
      "20s",
      "1m",
      "1m",
      "10m",
    ]);
    // 2 minutes, then about an hour, then 10-minute checks past the batch's 24 hours.
    expect(6 * 20 + 58 * 60 + (MAX_SCORE_POLLS - 64) * 600).toBeGreaterThan(
      24 * 3600,
    );
  });
});
