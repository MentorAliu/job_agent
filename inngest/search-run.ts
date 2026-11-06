import { AuthenticationError } from "@anthropic-ai/sdk";
import { NonRetriableError, type GetStepTools } from "inngest";

import { hasClaudeApiKey, NoApiKeyError } from "@/lib/claude/api-key";
import {
  BudgetExceededError,
  formatUsd,
  getBudgetState,
} from "@/lib/claude/budget";
import {
  discoverPostings,
  searchCriteria,
  type SearchCriteria,
  type SearchScope,
} from "@/lib/claude/discover";
import { readPosting, readPostingText } from "@/lib/claude/extract";
import { getStageSetup, llmCallRow } from "@/lib/claude/llm-call";
import {
  getScoreBatchProgress,
  profileContext,
  readScoreBatch,
  scoreEstimateUsd,
  scoreTask,
  submitScoreBatch,
  tidyScore,
} from "@/lib/claude/score";
import { answersOnCli } from "@/lib/claude/send";
import type { BoardPosting } from "@/lib/jobs/ats";
import {
  BOARDS_AT_ONCE,
  boardLinks,
  fetchBoardPostings,
  pickBoardLinks,
  watchedBoards,
  type BoardLink,
} from "@/lib/jobs/boards";
import {
  contentKey,
  looksLikeOpenWebPosting,
  looksLikePosting,
  postingLink,
  type PostingLink,
} from "@/lib/jobs/canonical-url";
import { isExcludedCompany } from "@/lib/jobs/companies";
import { checkEligibility } from "@/lib/jobs/eligibility";
import {
  FEED_IDS,
  FEEDS,
  feedLinks,
  fetchFeed,
  pickFeedLinks,
  worthReading,
  type FeedId,
  type FeedLink,
} from "@/lib/jobs/feeds";
import { ownerClock } from "@/lib/jobs/today";
import { getEligibleRoleLinks } from "@/lib/pipeline/boards";
import {
  getJobsToScore,
  insertJob,
  recordBatchCall,
  recordSeenLink,
  saveScore,
  unseenLinks,
} from "@/lib/pipeline/jobs";
import { autoPick } from "@/lib/pipeline/autopilot";
import {
  getFeedListings,
  getFeedPosting,
  recentFeedChecks,
  saveFeedCheck,
} from "@/lib/pipeline/feeds";
import { getUnsentRoles, markNotEligible } from "@/lib/pipeline/listings";
import {
  endRun,
  getRunStatus,
  getSearchInputs,
  searchReadiness,
  setRunCounts,
  updateRunStats,
} from "@/lib/pipeline/runs";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import { jobScoreSchema } from "@/lib/schemas/job";
import type { Preferences } from "@/lib/schemas/profile";
import { searchDomainGroups } from "@/lib/schemas/settings";

import { inngest } from "./client";
import {
  apiErrorMessage,
  isPermanentApiError,
  permanentOrRetry,
} from "./errors";
import { searchRunRequested, tailorRequested } from "./events";
import { httpUrl, postedOnFor } from "./postings";

/**
 * Discover calls per run (step 2): one for each group of job sites, then one
 * on the open web.
 */
export const MAX_DISCOVER_CALLS = 4;
/** Groups of job sites searched per run; the open web takes the last call. */
export const MAX_SITE_GROUPS = MAX_DISCOVER_CALLS - 1;
/** At most this many new postings are read per run (step 4). */
export const MAX_POSTINGS_PER_RUN = 60;
/** A run stops reading once it has this many postings to score. */
export const ENOUGH_MATCHES = 15;
/** Postings read at the same time (SPEC: 5). */
export const READ_CONCURRENCY = 5;
/** Postings sent in one scoring batch, including any left from earlier runs. */
export const MAX_SCORES_PER_RUN = 60;
/**
 * Postings scored in one step on another engine, one after another (in one
 * sandbox on a command-line agent), so the step ends well within its time
 * limit.
 */
export const CLI_SCORES_PER_STEP = 4;
/** Enough polls to outlast a batch's 24-hour expiry. */
export const MAX_SCORE_POLLS = 210;

/** How long to wait before each check on the scoring batch. */
export function scorePollDelay(poll: number): string {
  if (poll <= 6) return "20s"; // the first 2 minutes
  if (poll <= 64) return "1m"; // the rest of the first hour
  return "10m";
}

export type SearchSteps = Pick<GetStepTools<typeof inngest>, "run" | "sleep">;

export type SearchOutcome = {
  status: "succeeded" | "stopped" | "skipped";
  stopReason?: string;
};

/**
 * Steps 2–6 of the pipeline: discover, dedupe, read, check eligibility and
 * score. Each stage is its own Inngest step, so each is retried on its own
 * and no request has to outlast a function time limit. Before the searches,
 * the job boards of companies with a role the owner can take are checked
 * for new postings, and those are read first; then the remote job boards'
 * own feeds, whose postings are read next.
 */
export async function runSearch(
  runId: string,
  step: SearchSteps,
): Promise<SearchOutcome> {
  const start = await step.run("start", () => startStep(runId));
  if (!start.ok) return { status: "skipped", stopReason: start.reason };
  const { preferences } = start;
  const criteria = searchCriteria(preferences);
  // Roles found earlier meet today's rules before any are scored or picked.
  await step.run("recheck-roles", () => recheckStep(preferences));

  const stop = async (stopReason: string): Promise<SearchOutcome> => {
    await step.run("stop", () => endRun(runId, "stopped", stopReason));
    return { status: "stopped", stopReason };
  };

  // New postings at companies that already posted a role the owner can
  // take. Plain HTTP, no Claude call.
  const boards = await step.run("check-boards", () =>
    boardsStep(runId, preferences),
  );
  // The remote job boards' own feeds. Plain HTTP too.
  const feeds = await step.run("check-feeds", () =>
    feedsStep(runId, preferences),
  );

  // Steps 2 and 3: search each group of job sites, leaving out the boards
  // whose feeds were just read, then the rest of the web for employers' own
  // careers pages, keeping the new links.
  const scopes: SearchScope[] = [
    ...withoutSites(start.domainGroups, feeds.sites).map(
      (domains): SearchScope => ({ kind: "sites", domains }),
    ),
    {
      kind: "web",
      except: [
        ...new Set([
          ...start.domainGroups.flat(),
          ...FEED_IDS.map((id) => FEEDS[id].site),
        ]),
      ],
    },
  ];
  const groups: PostingLink[][] = [];
  const discovered = { searches: 0, found: 0, fresh: 0 };
  for (const [index, scope] of scopes.entries()) {
    const known = [...boards.links, ...feeds.links, ...groups.flat()].map(
      (link) => link.dedupeKey,
    );
    const id = scope.kind === "web" ? "discover-web" : `discover-${index + 1}`;
    const found = await step.run(id, () =>
      discoverStep(runId, criteria, scope, known),
    );
    if (found.stopReason) return stop(found.stopReason);
    groups.push(found.links);
    discovered.searches += found.searches;
    discovered.found += found.found;
    discovered.fresh += found.links.length;
  }
  // The companies' boards first, since their postings are the freshest,
  // then the feeds', already sorted by kind and date. Then one site's
  // results, or the open web's, can't crowd out the others.
  const toRead: (PostingLink | BoardLink | FeedLink)[] = [
    ...boards.links,
    ...feeds.links,
    ...interleave(groups),
  ].slice(0, MAX_POSTINGS_PER_RUN);
  await step.run("plan-reading", () =>
    setRunCounts(runId, { ...discovered, toRead: toRead.length }, "extracting"),
  );

  // Steps 4 and 5: read each posting and check eligibility, 5 at a time,
  // until there are enough matches to score.
  // Codex's sign-in serves one step at a time, so its reads go one by one.
  const readsAtOnce = start.serialReads ? 1 : READ_CONCURRENCY;
  const outcomes: ReadOutcome["outcome"][] = [];
  let matches = 0;
  for (
    let first = 0;
    first < toRead.length && matches < ENOUGH_MATCHES;
    first += readsAtOnce
  ) {
    const chunk = toRead.slice(first, first + readsAtOnce);
    const results = await Promise.all(
      chunk.map((link, offset) =>
        step
          .run(`read-${first + offset + 1}`, () =>
            readStep(runId, link, preferences),
          )
          // A posting that still fails after its retries doesn't end the run.
          .catch((): ReadOutcome => ({ outcome: "failed", reason: "" })),
      ),
    );
    outcomes.push(...results.map((result) => result.outcome));
    matches += results.filter((result) => result.match).length;
    const budget = results.find((result) => result.outcome === "budget");
    if (budget) return stop(budget.reason);
  }
  const count = (...kinds: ReadOutcome["outcome"][]) =>
    outcomes.filter((outcome) => kinds.includes(outcome)).length;
  await step.run("reading-done", () =>
    setRunCounts(
      runId,
      {
        toRead: outcomes.length,
        read: count("saved", "duplicate", "skipped"),
        duplicates: count("duplicate"),
        skipped: count("skipped", "failed"),
      },
      "scoring",
    ),
  );

  // Step 6 on a command-line agent: a few postings per step, on the owner's
  // plan. Any it can't score go in the batch below, on the API.
  const onCli = await step.run("score-cli-plan", () => cliScoringPlan(runId));
  for (
    let first = 0;
    first < onCli.jobIds.length;
    first += CLI_SCORES_PER_STEP
  ) {
    const ids = onCli.jobIds.slice(first, first + CLI_SCORES_PER_STEP);
    const done = await step
      .run(`score-cli-${first / CLI_SCORES_PER_STEP + 1}`, () =>
        scoreOnCliStep(runId, ids),
      )
      // Postings a failed step didn't score go in the batch.
      .catch(() => ({ scored: 0, stopped: true }));
    if (done.stopped) break;
  }

  // Step 6: score every eligible and unclear posting in one batch. The
  // step that creates the batch writes nothing else, so a retry can't
  // create a second one.
  const scoring = await step.run("score-submit", () =>
    submitScoringStep(runId),
  );
  if (scoring.batchId) {
    await step.run("score-planned", () =>
      setRunCounts(runId, { toScore: scoring.count }),
    );
    let ended = false;
    for (let poll = 1; poll <= MAX_SCORE_POLLS && !ended; poll++) {
      await step.sleep(`score-wait-${poll}`, scorePollDelay(poll));
      const progress = await step.run(`score-check-${poll}`, () =>
        getScoreBatchProgress(scoring.batchId),
      );
      ended = progress.ended;
    }
    if (!ended) return stop("Scoring didn't finish within a day.");
    await step.run("score-save", () =>
      saveScoresStep(runId, scoring.batchId, scoring.model),
    );
  }

  if (scoring.stopReason) return stop(scoring.stopReason);
  await step.run("finish", () => endRun(runId, "succeeded"));
  return { status: "succeeded" };
}

/** Links from each group in turn: the first of each, then the second, and so on. */
export function interleave<T>(groups: T[][]): T[] {
  const longest = Math.max(0, ...groups.map((group) => group.length));
  return Array.from({ length: longest }, (_, index) =>
    groups.flatMap((group) => (index < group.length ? [group[index]] : [])),
  ).flat();
}

/**
 * The domain groups without the given sites, as many groups as before (or
 * fewer, when few sites are left), the sites spread evenly across them.
 */
export function withoutSites(groups: string[][], sites: string[]): string[][] {
  const left = groups
    .flat()
    .filter(
      (domain) =>
        !sites.some((site) => domain === site || domain.endsWith(`.${site}`)),
    );
  if (left.length === groups.flat().length) return groups;
  const count = Math.min(groups.length, left.length);
  const size = Math.ceil(left.length / Math.max(1, count));
  return Array.from({ length: count }, (_, index) =>
    left.slice(index * size, (index + 1) * size),
  ).filter((group) => group.length > 0);
}

/**
 * The domain groups a run searches: all of them, or MAX_SITE_GROUPS
 * starting from a different group each day, so every board gets its turn.
 */
export function groupsToSearch(
  groups: string[][],
  now: number = Date.now(),
): string[][] {
  if (groups.length <= MAX_SITE_GROUPS) return groups;
  const start = Math.floor(now / 86_400_000) % groups.length;
  return [...groups.slice(start), ...groups.slice(0, start)].slice(
    0,
    MAX_SITE_GROUPS,
  );
}

/** Marks the run as started, after checking it can still go ahead. */
export async function startStep(runId: string): Promise<
  | {
      ok: true;
      preferences: Preferences;
      domainGroups: string[][];
      /** Postings are read one at a time, for Codex. */
      serialReads: boolean;
    }
  | { ok: false; reason: string }
> {
  const current = await getRunStatus(runId);
  if (!current) throw new NonRetriableError(`No run with id ${runId}.`);
  if (current.status !== "running") {
    return { ok: false, reason: `The run had already ${current.status}.` };
  }
  const inputs = await getSearchInputs();
  const missing = searchReadiness(inputs);
  if (!inputs.preferences || missing.length > 0) {
    const reason = missing.join(" ");
    await endRun(runId, "stopped", reason);
    return { ok: false, reason };
  }
  await updateRunStats(runId, {}, "discovering");
  const { engine } = await getStageSetup("extract");
  return {
    ok: true,
    preferences: inputs.preferences,
    domainGroups: groupsToSearch(searchDomainGroups(inputs.domains)),
    serialReads: engine === "codex",
  };
}

/**
 * Step 5 again, for the roles not sent yet: the ones the owner's current
 * preferences rule out, such as a hybrid role with remote only on, move to
 * Not eligible. Code only, no Claude calls. Each role is read inside the
 * step, so no posting text lands in Inngest's step history.
 */
export async function recheckStep(
  preferences: Preferences,
): Promise<{ ruledOut: number }> {
  let ruledOut = 0;
  for (const role of await getUnsentRoles()) {
    const verdict = checkEligibility(
      role.facts,
      preferences,
      role.descriptionMd ?? undefined,
    );
    if (verdict.eligibility !== "not_eligible") continue;
    if (await markNotEligible(role.id, verdict)) ruledOut++;
  }
  return { ruledOut };
}

/**
 * Before the searches: the job boards of companies that already posted a
 * role the owner can take, newest first. Keeps the developer roles posted
 * in the last STALE_DAYS that no run has read, the kind the owner wants
 * first, up to BOARD_POSTINGS_PER_RUN. A board that can't be read is left for next time.
 */
export async function boardsStep(
  runId: string,
  preferences: Preferences,
): Promise<{ links: BoardLink[]; boards: number }> {
  const clock = ownerClock(await readOwnerTimeZone());
  const { today } = clock;
  const boards = watchedBoards(
    await getEligibleRoleLinks(),
    preferences.excludedCompanies,
  );
  // A few boards at a time, so a handful of big ones never fill the memory.
  const postings: BoardPosting[] = [];
  for (let first = 0; first < boards.length; first += BOARDS_AT_ONCE) {
    const answers = await Promise.all(
      boards
        .slice(first, first + BOARDS_AT_ONCE)
        .map((board) => fetchBoardPostings(board, clock)),
    );
    postings.push(...answers.flatMap((answer) => answer ?? []));
  }
  const links = pickBoardLinks(
    await unseenLinks(boardLinks(postings, today, preferences)),
    today,
  );
  await setRunCounts(runId, {
    boards: boards.length,
    boardPostings: links.length,
  });
  return { links, boards: boards.length };
}

/**
 * Before the searches: the remote job boards' own feeds (lib/jobs/feeds.ts),
 * plain HTTP and no Claude call. A feed asked for in the last hour isn't
 * asked again; what it answered then is used. Keeps the developer roles the
 * owner wants that no run has read, up to FEED_POSTINGS_PER_RUN. A feed
 * that can't be read is left for next time, and its board's site is
 * searched as before. Each posting's text stays in the database, not in
 * the step's output.
 */
export async function feedsStep(
  runId: string,
  preferences: Preferences,
): Promise<{ links: FeedLink[]; sites: string[] }> {
  const now = new Date();
  const clock = ownerClock(await readOwnerTimeZone());
  const recent = new Map(
    (await recentFeedChecks(now)).map((check) => [check.feed, check.ok]),
  );
  const answered = await Promise.all(
    FEED_IDS.map(async (id): Promise<FeedId | null> => {
      const ok = recent.get(id);
      if (ok !== undefined) return ok ? id : null;
      const postings = await fetchFeed(id, preferences, clock);
      await saveFeedCheck(
        id,
        postings && worthReading(postings, clock.today, preferences),
        now,
      );
      return postings ? id : null;
    }),
  );
  const read = answered.filter((id): id is FeedId => id !== null);
  const links = pickFeedLinks(
    await unseenLinks(
      feedLinks(await getFeedListings(read), clock.today, preferences),
    ),
    clock.today,
  );
  await setRunCounts(runId, { feeds: read.length, feedPostings: links.length });
  return { links, sites: read.map((id) => FEEDS[id].site) };
}

/** Steps 2 and 3: one discover call, then only the links not stored yet. */
export async function discoverStep(
  runId: string,
  criteria: SearchCriteria,
  scope: SearchScope,
  known: string[],
): Promise<{
  links: PostingLink[];
  searches: number;
  found: number;
  stopReason?: string;
}> {
  try {
    const result = await discoverPostings(criteria, scope, runId);
    const seen = new Set(known);
    const links: PostingLink[] = [];
    for (const url of result.urls) {
      if (!inScope(url, scope)) continue;
      const link = postingLink(url);
      if (!link || seen.has(link.dedupeKey)) continue;
      seen.add(link.dedupeKey);
      links.push(link);
    }
    const fresh = await unseenLinks(links);
    await updateRunStats(runId, {
      searches: result.searches,
      found: links.length,
      fresh: fresh.length,
    });
    return { links: fresh, searches: result.searches, found: links.length };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { links: [], searches: 0, found: 0, stopReason: error.message };
    }
    // The open web only adds to the job sites: a request the API rejects
    // there leaves the run with the sites' links.
    if (
      scope.kind === "web" &&
      isPermanentApiError(error) &&
      !(error instanceof AuthenticationError)
    ) {
      console.warn(`Open-web search skipped: ${apiErrorMessage(error)}`);
      return { links: [], searches: 0, found: 0 };
    }
    throw permanentOrRetry(error);
  }
}

/** Whether a search result link may be one posting, in the call's scope. */
function inScope(url: string, scope: SearchScope): boolean {
  return scope.kind === "sites"
    ? looksLikePosting(url) && onDomains(url, scope.domains)
    : looksLikeOpenWebPosting(url);
}

function onDomains(url: string, domains: string[]): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

type ReadOutcome = {
  outcome: "saved" | "duplicate" | "skipped" | "failed" | "budget";
  reason: string;
  /** A new posting to score: eligible or unclear, and not excluded. */
  match?: boolean;
};

/**
 * Steps 4 and 5: read one posting, check eligibility, store it. A posting
 * from a feed is read from the feed's text, and is applied for where the
 * board's terms ask.
 */
export async function readStep(
  runId: string,
  link: PostingLink | BoardLink | FeedLink,
  preferences: Preferences,
): Promise<ReadOutcome> {
  try {
    const clock = ownerClock(await readOwnerTimeZone());
    const fromFeed =
      "feed" in link ? await getFeedPosting(link.dedupeKey) : null;
    const result = fromFeed
      ? await readPostingText(link.canonicalUrl, fromFeed.text, runId, clock)
      : await readPosting(link.canonicalUrl, runId, clock);
    if (result.kind === "skipped") {
      await recordSeenLink(link, result.reason, runId, {
        mayPass: !result.final,
      });
      await updateRunStats(runId, { read: 1, skipped: 1 });
      return { outcome: "skipped", reason: result.reason };
    }

    const { facts, pageText } = result;
    const verdict = checkEligibility(facts, preferences, pageText ?? undefined);
    const company = facts.company.trim() || new URL(link.canonicalUrl).hostname;
    const excluded = isExcludedCompany(company, preferences.excludedCompanies);
    const applyUrl = fromFeed?.applyUrl ?? httpUrl(facts.applyUrl);
    const saved = await insertJob({
      canonicalUrl: link.canonicalUrl,
      dedupeKey: link.dedupeKey,
      contentKey: contentKey({
        company,
        title: facts.title,
        allowed: facts.location.allowed,
      }),
      applyUrl,
      postedOn: await postedOnFor(
        link,
        applyUrl,
        pageText,
        result.postedOn,
        clock,
      ),
      company,
      title: facts.title.trim() || "Untitled role",
      // Shown as plain text, never as HTML.
      descriptionMd: pageText?.slice(0, 60_000) ?? null,
      facts,
      eligibility: verdict.eligibility,
      eligibilityQuote: verdict.quote || null,
      eligibilityReasons: excluded
        ? [
            `${company} is on your list of companies to exclude.`,
            ...verdict.reasons,
          ]
        : verdict.reasons,
      // Postings the owner can't take, or excluded, leave the new matches.
      status: excluded
        ? "skipped"
        : verdict.eligibility === "not_eligible"
          ? "not_eligible"
          : "new",
      firstRunId: runId,
    });
    if (saved === "duplicate") {
      await recordSeenLink(
        link,
        "The same posting is stored at another link.",
        runId,
      );
    }
    await updateRunStats(
      runId,
      saved === "saved" ? { read: 1 } : { read: 1, duplicates: 1 },
    );
    return {
      outcome: saved,
      reason: "",
      match:
        saved === "saved" &&
        !excluded &&
        verdict.eligibility !== "not_eligible",
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { outcome: "budget", reason: error.message };
    }
    // A request the API rejects for this page only skips the page.
    if (isPermanentApiError(error) && !(error instanceof AuthenticationError)) {
      await recordSeenLink(link, apiErrorMessage(error), runId, {
        mayPass: true,
      });
      await updateRunStats(runId, { read: 1, skipped: 1 });
      return { outcome: "skipped", reason: apiErrorMessage(error) };
    }
    throw permanentOrRetry(error);
  }
}

/**
 * Step 6 on another engine, part 1: the postings to score, when Settings
 * picked a command-line agent or the OpenAI API. Only their ids land in
 * Inngest's step history.
 */
export async function cliScoringPlan(
  runId: string,
): Promise<{ jobIds: string[] }> {
  const setup = await getStageSetup("score");
  if (!setup.engine) return { jobIds: [] };
  const jobs = await getJobsToScore(MAX_SCORES_PER_RUN);
  if (jobs.length > 0) await setRunCounts(runId, { toScore: jobs.length });
  return { jobIds: jobs.map((job) => job.id) };
}

/**
 * Step 6 on another engine, part 2: scores a few postings, in one sandbox on
 * a command-line agent, and saves each score with its `llm_call` row ($0 on
 * the owner's plan). A posting the engine can't score stays unscored, for
 * the batch. `stopped` says the engine scored none, such as at its plan's
 * limit, so the rest go to the batch too.
 */
export async function scoreOnCliStep(
  runId: string,
  ids: string[],
): Promise<{ scored: number; stopped: boolean }> {
  const setup = await getStageSetup("score");
  const { engine } = setup;
  if (!engine) return { scored: 0, stopped: true };
  // A retry scores only the postings the first try didn't.
  const jobs = await getJobsToScore(ids.length, ids);
  if (jobs.length === 0) return { scored: 0, stopped: false };
  const { profile, preferences } = await getSearchInputs();
  if (!profile || !preferences) return { scored: 0, stopped: true };

  const profileText = profileContext(profile, preferences);
  const answers = await answersOnCli(
    setup,
    jobs.map((job) => scoreTask(profileText, job, setup.model)),
    (output) => tidyScore(jobScoreSchema.parse(output)),
    runId,
  );
  let scored = 0;
  for (const [index, answer] of answers.entries()) {
    if (!answer) continue;
    const { id } = jobs[index];
    const { reply } = answer;
    const call = llmCallRow(answer.setup, reply.usage, reply.requestId, {
      runId,
      jobId: id,
      engine: answer.engine,
    });
    if (await saveScore(id, answer.value, call)) scored++;
  }
  return { scored, stopped: answers.every((answer) => answer === null) };
}

/**
 * Step 6, part 1: sends the postings to score as one batch, as many as the
 * budget allows. The profile is read inside the step, so it never lands in
 * Inngest's step history.
 */
export async function submitScoringStep(runId: string): Promise<{
  batchId: string;
  model: string;
  count: number;
  stopReason?: string;
}> {
  const jobs = await getJobsToScore(MAX_SCORES_PER_RUN);
  if (jobs.length === 0) return { batchId: "", model: "", count: 0 };

  const { profile, preferences } = await getSearchInputs();
  if (!profile || !preferences) {
    return {
      batchId: "",
      model: "",
      count: 0,
      stopReason: "The profile was removed before scoring.",
    };
  }
  const profileText = profileContext(profile, preferences);
  const setup = await getStageSetup("score");
  // Postings a plan's agent couldn't score wait for the next run.
  if (!(await hasClaudeApiKey())) {
    return {
      batchId: "",
      model: "",
      count: 0,
      stopReason: `${jobs.length === 1 ? "1 posting waits" : `${jobs.length} postings wait`} for the next run. ${new NoApiKeyError(setup.engine).message}`,
    };
  }
  const budget = await getBudgetState(runId);

  let total = 0;
  const affordable = [];
  for (const job of jobs) {
    const estimate = scoreEstimateUsd(setup, profileText, job);
    if (total + estimate > budget.remainingUsd) break;
    total += estimate;
    affordable.push(job);
  }
  const cap =
    budget.scope === "run"
      ? `the ${formatUsd(budget.limits.runUsd)} per-run budget`
      : `the ${formatUsd(budget.limits.monthlyUsd)} monthly budget`;
  if (affordable.length === 0) {
    return {
      batchId: "",
      model: "",
      count: 0,
      stopReason: `Stopped at ${cap} before scoring. ${jobs.length} postings wait for the next run.`,
    };
  }

  try {
    const batchId = await submitScoreBatch(
      profileText,
      affordable,
      setup.model,
    );
    return {
      batchId,
      model: setup.model,
      count: affordable.length,
      stopReason:
        affordable.length < jobs.length
          ? `Stopped at ${cap}: scored ${affordable.length} of ${jobs.length} postings. The rest wait for the next run.`
          : undefined,
    };
  } catch (error) {
    throw permanentOrRetry(error);
  }
}

/** Step 6, part 2: saves each score and logs each request's cost. */
export async function saveScoresStep(
  runId: string,
  batchId: string,
  model: string,
): Promise<{ scored: number; failed: number }> {
  const setup = await getStageSetup("score", model);
  let scored = 0;
  let failed = 0;
  for await (const result of readScoreBatch(batchId)) {
    const call = result.usage
      ? llmCallRow(setup, result.usage, `${batchId}:${result.jobId}`, {
          runId,
          jobId: result.jobId,
          batch: true,
        })
      : null;
    if (result.kind === "scored" && call) {
      if (await saveScore(result.jobId, result.score, call)) scored++;
    } else {
      if (call) await recordBatchCall(call);
      failed++;
    }
  }
  await setRunCounts(runId, { scoreFailed: failed });
  return { scored, failed };
}

/** Runs the search for each `search/run.requested` event, one run at a time. */
export const searchRun = inngest.createFunction(
  {
    id: "search-run",
    name: "Search for jobs",
    triggers: [searchRunRequested],
    // Limits steps, not runs: lets the reads run 5 at a time. createRun
    // keeps it to one run at a time.
    concurrency: { limit: READ_CONCURRENCY },
    retries: 2,
    onFailure: async ({ event, error }) => {
      await endRun(
        event.data.event.data.runId,
        "failed",
        error.message.slice(0, 500),
      );
    },
  },
  async ({ event, step }) => {
    const outcome = await runSearch(event.data.runId, step);
    if (outcome.status === "skipped") return outcome;
    // The best matches get apply kits; the rest are passed over.
    const sorted = await step.run("auto-pick", () => autoPick());
    if (sorted.kits.length > 0) {
      await step.sendEvent(
        "prepare-kits",
        sorted.kits.map((kit) => tailorRequested.create(kit)),
      );
    }
    return { ...outcome, ...sorted, kits: sorted.kits.length };
  },
);
