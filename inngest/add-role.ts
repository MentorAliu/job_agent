import { AuthenticationError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  BudgetExceededError,
  budgetStopMessage,
  getBudgetState,
} from "@/lib/claude/budget";
import { getAnthropic } from "@/lib/claude/client";
import { readPosting, readPostingText } from "@/lib/claude/extract";
import { getStageSetup } from "@/lib/claude/llm-call";
import {
  buildScoreRequest,
  profileContext,
  scoreEstimateUsd,
  scoreTask,
  tidyScore,
} from "@/lib/claude/score";
import { sendRequest } from "@/lib/claude/send";
import { KIT_ESTIMATE_USD } from "@/lib/jobs/auto-pick";
import { contentKey, postingLink } from "@/lib/jobs/canonical-url";
import { isExcludedCompany } from "@/lib/jobs/companies";
import { checkEligibility } from "@/lib/jobs/eligibility";
import { ownerClock } from "@/lib/jobs/today";
import {
  findJobId,
  finishAddedRole,
  getAddedJob,
  getAddedRole,
  hasProfileSnapshot,
  saveAddedScore,
  shortlistAddedRole,
} from "@/lib/pipeline/added-roles";
import { getJobsToScore, insertJob } from "@/lib/pipeline/jobs";
import { getSearchInputs } from "@/lib/pipeline/runs";
import { readSettings } from "@/lib/pipeline/settings";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";
import { jobScoreSchema } from "@/lib/schemas/job";
import { isCliEngine } from "@/lib/schemas/settings";

import { inngest } from "./client";
import {
  apiErrorMessage,
  isPermanentApiError,
  permanentOrRetry,
} from "./errors";
import { roleAddRequested, tailorRequested } from "./events";
import { httpUrl, postedOnFor } from "./postings";

// Add a role: a posting the owner gives by its link, with its text when the
// app can't read the page. It goes through the same reading, eligibility
// check and score as a role a search finds, and the owner wanting it is
// reason enough for its kit.

export type AddedRead =
  { kind: "role"; jobId: string; existing: boolean } | { kind: "stopped" };

const PASTE_HINT = "Paste the posting's text with the link, and add it again.";

/**
 * Reads the posting and stores it as a role, or finds the role it already
 * is. Anything that stops it is noted on the added role for the Roles page.
 */
export async function readAddedStep(addedRoleId: string): Promise<AddedRead> {
  const added = await getAddedRole(addedRoleId);
  if (!added || added.status !== "reading") return { kind: "stopped" };
  const stop = async (note: string): Promise<AddedRead> => {
    await finishAddedRole(addedRoleId, "failed", note);
    return { kind: "stopped" };
  };

  const link = postingLink(added.url);
  if (!link) return stop("That link isn't a web page.");
  const known = await findJobId({ dedupeKey: link.dedupeKey });
  if (known) return { kind: "role", jobId: known, existing: true };

  const { preferences } = await getSearchInputs();
  if (!preferences) {
    return stop(
      "Save your job preferences first, so the app can check the role is open to you.",
    );
  }
  const clock = ownerClock(await readOwnerTimeZone());
  let result;
  try {
    result = added.text
      ? await readPostingText(link.canonicalUrl, added.text, null, clock)
      : await readPosting(link.canonicalUrl, null, clock);
  } catch (error) {
    if (error instanceof BudgetExceededError) return stop(error.message);
    if (isPermanentApiError(error) && !(error instanceof AuthenticationError)) {
      return stop(apiErrorMessage(error));
    }
    throw permanentOrRetry(error);
  }
  if (result.kind === "skipped") {
    return stop(added.text ? result.reason : `${result.reason} ${PASTE_HINT}`);
  }

  const { facts, pageText } = result;
  const verdict = checkEligibility(facts, preferences, pageText ?? undefined);
  const company = facts.company.trim() || new URL(link.canonicalUrl).hostname;
  const excluded = isExcludedCompany(company, preferences.excludedCompanies);
  // The link the owner gave is where they found it, so it's where to apply
  // when the posting names nowhere else.
  const applyUrl = httpUrl(facts.applyUrl) ?? link.canonicalUrl;
  const key = contentKey({
    company,
    title: facts.title,
    allowed: facts.location.allowed,
  });
  const saved = await insertJob({
    canonicalUrl: link.canonicalUrl,
    dedupeKey: link.dedupeKey,
    contentKey: key,
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
    status: excluded
      ? "skipped"
      : verdict.eligibility === "not_eligible"
        ? "not_eligible"
        : "new",
    addedByOwner: true,
    firstRunId: null,
  });
  const jobId = await findJobId({ dedupeKey: link.dedupeKey, contentKey: key });
  if (!jobId) throw new Error("The role wasn't stored. Trying again.");
  return { kind: "role", jobId, existing: saved === "duplicate" };
}

/**
 * Scores the role right away, on the agent Settings picked or the Claude
 * API, one request rather than a batch. A role that can't be scored now
 * keeps going: its kit doesn't need the score.
 */
export async function scoreAddedStep(
  jobId: string,
): Promise<{ score: number | null }> {
  const [toScore] = await getJobsToScore(1, [jobId]);
  if (!toScore) return { score: (await getAddedJob(jobId))?.score ?? null };
  const { profile, preferences } = await getSearchInputs();
  if (!profile || !preferences) return { score: null };

  const setup = await getStageSetup("score");
  const profileText = profileContext(profile, preferences);
  try {
    const sent = await sendRequest({
      setup,
      request: buildScoreRequest(profileText, toScore, setup.model),
      // The batch estimate is at half price.
      estimateUsd: 2 * scoreEstimateUsd(setup, profileText, toScore),
      client: getAnthropic(),
      cliTask: scoreTask(profileText, toScore, setup.model),
    });
    await sent.record({ jobId });
    const answer = sent.message.content
      .filter((block) => block.type === "text")
      .at(-1)?.text;
    if (!answer || sent.message.stop_reason !== "end_turn") {
      return { score: null };
    }
    let score;
    try {
      score = tidyScore(zodOutputFormat(jobScoreSchema).parse(answer));
    } catch {
      return { score: null };
    }
    await saveAddedScore(jobId, score);
    return { score: score.score };
  } catch (error) {
    if (error instanceof BudgetExceededError) return { score: null };
    if (isPermanentApiError(error) && !(error instanceof AuthenticationError)) {
      return { score: null };
    }
    throw permanentOrRetry(error);
  }
}

/**
 * Shortlists the role with a kit when the owner can take it, and says on
 * the added role what came of it. Returns the tailoring request to send.
 */
export async function kitAddedStep(
  addedRoleId: string,
  jobId: string,
  existing: boolean,
  now = new Date(),
): Promise<{ jobId: string; requestId: string } | null> {
  const role = await getAddedJob(jobId);
  if (!role) {
    await finishAddedRole(addedRoleId, "failed", "The role was removed.");
    return null;
  }
  const done = (note: string) =>
    finishAddedRole(addedRoleId, "done", note, jobId);
  const already = existing ? "It was already in your roles. " : "";

  const { preferences } = await getSearchInputs();
  if (
    preferences &&
    isExcludedCompany(role.company, preferences.excludedCompanies)
  ) {
    await done(
      `${already}${role.company} is on your list of companies to exclude, so the app makes no kit for it.`,
    );
    return null;
  }
  if (role.eligibility === "not_eligible" || role.status === "not_eligible") {
    const why = role.eligibilityReasons[0];
    await done(
      `${already}It isn't open to you${why ? `: ${why.replace(/\.$/, "")}` : ""}. Open it to see why.`,
    );
    return null;
  }
  if (role.status !== "new" && role.status !== "skipped") {
    await done(`${already}Open it to see where it's at.`.trim());
    return null;
  }
  if (!(await hasProfileSnapshot())) {
    await done(
      `${already}Save your profile, then press Prepare kit on the role.`,
    );
    return null;
  }
  const [settings, budget] = await Promise.all([
    readSettings(),
    getBudgetState(),
  ]);
  if (
    !isCliEngine(settings.agentEngine) &&
    budget.remainingUsd < KIT_ESTIMATE_USD
  ) {
    await done(
      `${already}Its kit waits: ${budgetStopMessage(budget)} Press Prepare kit on the role when there's room.`,
    );
    return null;
  }

  const requestId = await shortlistAddedRole(jobId, now);
  if (!requestId) {
    await done(`${already}Open it to see where it's at.`.trim());
    return null;
  }
  await done(`${already}Its kit is being made.`);
  return { jobId, requestId };
}

/** Runs Add a role for each `role/add.requested` event. */
export const addRole = inngest.createFunction(
  {
    id: "add-role",
    name: "Add a role",
    triggers: [roleAddRequested],
    retries: 2,
    onFailure: async ({ event, error }) => {
      await finishAddedRole(
        event.data.event.data.addedRoleId,
        "failed",
        `Couldn't add it: ${error.message.slice(0, 300)}`,
      );
    },
  },
  async ({ event, step }) => {
    const { addedRoleId } = event.data;
    const read = await step.run("read", () => readAddedStep(addedRoleId));
    if (read.kind === "stopped") return read;
    const scored = await step.run("score", () => scoreAddedStep(read.jobId));
    const kit = await step.run("kit", () =>
      kitAddedStep(addedRoleId, read.jobId, read.existing),
    );
    if (kit) await step.sendEvent("prepare-kit", tailorRequested.create(kit));
    return { ...read, ...scored, kit: kit !== null };
  },
);
