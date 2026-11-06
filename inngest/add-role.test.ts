import { beforeEach, describe, expect, it, vi } from "vitest";

import type { job } from "@/db/schema";
import type { JobToScore } from "@/lib/claude/score";
import { postingLink } from "@/lib/jobs/canonical-url";
import type { AddedRoleStatus } from "@/lib/schemas/added-role";
import type { JobFacts } from "@/lib/schemas/job";
import {
  cvExtractionSchema,
  toMasterProfile,
  type Preferences,
} from "@/lib/schemas/profile";
import { DEFAULT_PRICE_TABLE, type AgentEngine } from "@/lib/schemas/settings";
import cv from "@/test/fixtures/claude/parse-cv-response.json";
import { samplePreferences } from "@/test/sample-preferences";

// Add a role, step by step, with the database and Claude replaced by an
// in-memory store and made-up postings. The eligibility check, dedupe keys
// and budget check are the real ones.

type StoredJob = typeof job.$inferInsert & {
  id: string;
  score: number | null;
};
type StoredAdded = {
  id: string;
  url: string;
  text: string;
  status: AddedRoleStatus;
  note: string | null;
  jobId: string | null;
};

const store = {
  added: new Map<string, StoredAdded>(),
  jobs: [] as StoredJob[],
  events: [] as { jobId: string; from: string; reason: string }[],
  calls: [] as { stage: string; costUsd: number; jobId?: string }[],
  /** The links read by fetching the page, and those read from pasted text. */
  pageReads: [] as string[],
  textReads: [] as { url: string; text: string }[],
  engine: "claude_api" as AgentEngine,
  monthlyUsd: 20,
  hasSnapshot: true,
};

const profile = toMasterProfile(
  cvExtractionSchema.parse(
    JSON.parse((cv.body.content[0] as { text: string }).text),
  ),
);
const preferences: Preferences = {
  ...samplePreferences,
  stack: ["React", "TypeScript"],
  seniority: ["senior"],
  excludedCompanies: ["Globex"],
};

// ---------------------------------------------------------------------------
// Made-up postings, by link
// ---------------------------------------------------------------------------

type Posting = { company: string; title: string; allowed: string[] };
const POSTINGS: Record<string, Posting | "not readable"> = {
  "https://jobs.ashbyhq.com/lattice/1a2b3c": {
    company: "Lattice Works",
    title: "Senior Frontend Engineer",
    allowed: ["Europe"],
  },
  "https://www.linkedin.com/jobs/view/4012345678": {
    company: "Ridge Pay",
    title: "Senior React Developer",
    allowed: ["Montenegro", "Albania"],
  },
  "https://boards.greenhouse.io/harbor/jobs/2002": {
    company: "Harbor Labs",
    title: "Senior Frontend Engineer",
    allowed: ["United States"],
  },
  "https://jobs.lever.co/globex/9f8e7d": {
    company: "Globex",
    title: "Senior Frontend Engineer",
    allowed: ["Europe"],
  },
  "https://careers.example.com/roles/frontend": "not readable",
};

function factsFor(item: Posting): JobFacts {
  return {
    company: item.company,
    title: item.title,
    summary: `${item.title} at ${item.company}.`,
    location: {
      workplace: "remote",
      quote: `Remote within ${item.allowed.join(" or ")}.`,
      allowed: item.allowed,
      placesAre: "required",
      excluded: [],
    },
    timeZones: { quote: "", utcOffsetMin: null, utcOffsetMax: null },
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

function readMadeUp(url: string) {
  const found = Object.keys(POSTINGS).find(
    (key) => postingLink(key)?.canonicalUrl === url,
  );
  const item = found ? POSTINGS[found] : undefined;
  if (!item) throw new Error(`No made-up posting at ${url}`);
  if (item === "not readable") {
    return {
      kind: "skipped" as const,
      reason: "The page couldn't be read (url_not_accessible).",
      final: false,
      costUsd: 0.001,
    };
  }
  const facts = factsFor(item);
  return {
    kind: "posting" as const,
    facts,
    postedOn: null,
    pageText: `${item.title}\n${item.company}\n${facts.location.quote}`,
    costUsd: 0.001,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/pipeline/setup", () => ({
  readOwnerTimeZone: async () => "Europe/Belgrade",
}));

vi.mock("@/lib/pipeline/runs", () => ({
  getSearchInputs: async () => ({
    profile,
    preferences,
    domains: [],
    dailyRunEnabled: true,
  }),
}));

vi.mock("@/lib/pipeline/settings", () => ({
  readSettings: async () => ({ agentEngine: store.engine }),
}));

vi.mock("@/lib/pipeline/budget", () => ({
  getBudgetLimits: async () => ({ monthlyUsd: store.monthlyUsd, runUsd: 1 }),
  getMonthSpendUsd: async () =>
    store.calls.reduce((sum, call) => sum + call.costUsd, 0),
  getRunSpendUsd: async () => 0,
}));

vi.mock("@/lib/claude/client", () => ({ getAnthropic: () => ({}) }));

vi.mock("@/lib/claude/llm-call", () => ({
  getStageSetup: async (stage: string) => ({
    stage,
    model: "claude-haiku-5-5",
    price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
    webSearchPer1k: 10,
  }),
}));

vi.mock("@/lib/jobs/listing-check", () => ({
  checkListing: async () => ({ verdict: "open", fromAts: false, reason: "" }),
}));

const { assertWithinBudget } = await import("@/lib/claude/budget");

vi.mock("@/lib/claude/extract", () => ({
  readPosting: async (url: string, runId: string | null) => {
    expect(runId).toBeNull();
    store.pageReads.push(url);
    store.calls.push({ stage: "extract", costUsd: 0.001 });
    return readMadeUp(url);
  },
  readPostingText: async (url: string, text: string, runId: string | null) => {
    expect(runId).toBeNull();
    store.textReads.push({ url, text });
    store.calls.push({ stage: "extract", costUsd: 0.001 });
    return readMadeUp(url);
  },
}));

vi.mock("@/lib/claude/send", () => ({
  sendRequest: async ({ estimateUsd }: { estimateUsd: number }) => {
    await assertWithinBudget(estimateUsd);
    return {
      message: {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              focus: "frontend",
              reasons: ["Your React work matches the role."],
              gaps: [],
              score: 88.4,
            }),
          },
        ],
        usage: { input_tokens: 2000, output_tokens: 150 },
      },
      requestId: "req_1",
      record: async (links?: { jobId?: string }) => {
        store.calls.push({ stage: "score", costUsd: 0.002, ...links });
        return 0.002;
      },
    };
  },
}));

vi.mock("@/lib/pipeline/jobs", () => ({
  insertJob: async (values: typeof job.$inferInsert) => {
    const existing = store.jobs.find(
      (stored) =>
        stored.dedupeKey === values.dedupeKey ||
        (values.contentKey && stored.contentKey === values.contentKey),
    );
    if (existing) {
      return existing.dedupeKey === values.dedupeKey &&
        existing.firstRunId === values.firstRunId
        ? "saved"
        : "duplicate";
    }
    store.jobs.push({ ...values, id: crypto.randomUUID(), score: null });
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
      .map((stored): JobToScore => ({
        id: stored.id,
        title: stored.title,
        company: stored.company,
        facts: stored.facts as JobFacts,
        eligibility: stored.eligibility!,
        eligibilityReasons: stored.eligibilityReasons ?? [],
      })),
}));

vi.mock("@/lib/pipeline/added-roles", () => ({
  ADDED_ROLE_REASON: "You added this role, so its kit is made right away.",
  getAddedRole: async (id: string) => store.added.get(id) ?? null,
  finishAddedRole: async (
    id: string,
    status: AddedRoleStatus,
    note: string,
    jobId: string | null = null,
  ) => {
    const added = store.added.get(id);
    if (!added) return;
    Object.assign(added, { status, note }, jobId ? { jobId } : {});
  },
  findJobId: async (keys: { dedupeKey: string; contentKey?: string | null }) =>
    (
      store.jobs.find((stored) => stored.dedupeKey === keys.dedupeKey) ??
      (keys.contentKey
        ? store.jobs.find((stored) => stored.contentKey === keys.contentKey)
        : undefined)
    )?.id ?? null,
  getAddedJob: async (jobId: string) => {
    const stored = store.jobs.find((entry) => entry.id === jobId);
    return stored
      ? {
          status: stored.status ?? "new",
          eligibility: stored.eligibility ?? null,
          eligibilityReasons: stored.eligibilityReasons ?? [],
          company: stored.company,
          score: stored.score,
        }
      : null;
  },
  saveAddedScore: async (jobId: string, score: { score: number }) => {
    const stored = store.jobs.find((entry) => entry.id === jobId);
    if (stored && stored.score === null) stored.score = score.score;
  },
  hasProfileSnapshot: async () => store.hasSnapshot,
  shortlistAddedRole: async (jobId: string) => {
    const stored = store.jobs.find((entry) => entry.id === jobId);
    if (!stored || !["new", "skipped"].includes(stored.status ?? "new")) {
      return null;
    }
    store.events.push({
      jobId,
      from: stored.status ?? "new",
      reason: "You added this role, so its kit is made right away.",
    });
    stored.status = "shortlisted";
    return "9c2e4a6b-1d3f-4b5a-8c7d-6e5f4a3b2c1d";
  },
}));

const { kitAddedStep, readAddedStep, scoreAddedStep } =
  await import("./add-role");

/** Adds a role the way the Roles page does, then runs its three steps. */
async function addAndRun(url: string, text = "") {
  const id = crypto.randomUUID();
  store.added.set(id, {
    id,
    url,
    text,
    status: "reading",
    note: null,
    jobId: null,
  });
  const read = await readAddedStep(id);
  if (read.kind === "stopped") {
    return { added: store.added.get(id)!, kit: null, stored: undefined };
  }
  await scoreAddedStep(read.jobId);
  const kit = await kitAddedStep(id, read.jobId, read.existing);
  const stored = store.jobs.find((entry) => entry.id === read.jobId);
  return { added: store.added.get(id)!, kit, stored };
}

beforeEach(() => {
  store.added.clear();
  store.jobs = [];
  store.events = [];
  store.calls = [];
  store.pageReads = [];
  store.textReads = [];
  store.engine = "claude_api";
  store.monthlyUsd = 20;
  store.hasSnapshot = true;
});

describe("Add a role", () => {
  it("reads the link, keeps it as the owner's role, scores it and starts its kit", async () => {
    const { added, kit, stored } = await addAndRun(
      "https://jobs.ashbyhq.com/lattice/1a2b3c?utm_source=friend",
    );
    expect(store.pageReads).toEqual([
      "https://jobs.ashbyhq.com/lattice/1a2b3c",
    ]);
    expect(stored).toMatchObject({
      company: "Lattice Works",
      eligibility: "eligible",
      addedByOwner: true,
      firstRunId: null,
      // Where they found it, as the posting names nowhere else.
      applyUrl: "https://jobs.ashbyhq.com/lattice/1a2b3c",
      score: 88,
      status: "shortlisted",
    });
    expect(kit).toEqual({
      jobId: stored!.id,
      requestId: "9c2e4a6b-1d3f-4b5a-8c7d-6e5f4a3b2c1d",
    });
    expect(store.events).toEqual([
      {
        jobId: stored!.id,
        from: "new",
        reason: "You added this role, so its kit is made right away.",
      },
    ]);
    expect(added).toMatchObject({
      status: "done",
      note: "Its kit is being made.",
      jobId: stored!.id,
    });
    expect(store.calls.find((call) => call.stage === "score")?.jobId).toBe(
      stored!.id,
    );
  });

  it("reads the pasted text, not the page, of a site that forbids apps", async () => {
    const text =
      "Senior React Developer at Ridge Pay. Remote within Montenegro.";
    const { added, stored } = await addAndRun(
      "https://www.linkedin.com/jobs/view/4012345678",
      text,
    );
    expect(store.pageReads).toEqual([]);
    expect(store.textReads).toEqual([
      { url: "https://linkedin.com/jobs/view/4012345678", text },
    ]);
    expect(stored?.status).toBe("shortlisted");
    expect(added.status).toBe("done");
  });

  it("doesn't read a role the app already has, and makes a kit for one it passed over", async () => {
    await addAndRun("https://jobs.ashbyhq.com/lattice/1a2b3c");
    store.jobs[0]!.status = "skipped";
    store.pageReads = [];

    const { added, kit } = await addAndRun(
      "https://jobs.ashbyhq.com/lattice/1a2b3c",
    );
    expect(store.pageReads).toEqual([]);
    expect(store.jobs).toHaveLength(1);
    expect(kit).not.toBeNull();
    expect(store.events.at(-1)?.from).toBe("skipped");
    expect(added.note).toBe(
      "It was already in your roles. Its kit is being made.",
    );
  });

  it("leaves a role already on its way alone", async () => {
    await addAndRun("https://jobs.ashbyhq.com/lattice/1a2b3c");
    const { added, kit } = await addAndRun(
      "https://jobs.ashbyhq.com/lattice/1a2b3c",
    );
    expect(kit).toBeNull();
    expect(added).toMatchObject({
      status: "done",
      note: "It was already in your roles. Open it to see where it's at.",
    });
  });

  it("keeps a role the owner can't take, with no kit, and says why", async () => {
    const { added, kit, stored } = await addAndRun(
      "https://boards.greenhouse.io/harbor/jobs/2002",
    );
    expect(stored).toMatchObject({
      status: "not_eligible",
      eligibility: "not_eligible",
      score: null,
    });
    expect(kit).toBeNull();
    expect(added.status).toBe("done");
    expect(added.note).toMatch(
      /^It isn't open to you: .+\. Open it to see why\.$/,
    );
  });

  it("makes no kit for a company the owner excluded", async () => {
    const { added, kit, stored } = await addAndRun(
      "https://jobs.lever.co/globex/9f8e7d",
    );
    expect(stored?.status).toBe("skipped");
    expect(kit).toBeNull();
    expect(added.note).toBe(
      "Globex is on your list of companies to exclude, so the app makes no kit for it.",
    );
  });

  it("asks for the posting's text when the page can't be read", async () => {
    const { added } = await addAndRun(
      "https://careers.example.com/roles/frontend",
    );
    expect(store.jobs).toEqual([]);
    expect(added).toMatchObject({
      status: "failed",
      note: "The page couldn't be read (url_not_accessible). Paste the posting's text with the link, and add it again.",
    });
  });

  it("keeps the role when the budget is spent, and says its kit waits", async () => {
    store.monthlyUsd = 0.0015;
    const { added, kit, stored } = await addAndRun(
      "https://jobs.ashbyhq.com/lattice/1a2b3c",
    );
    expect(stored).toMatchObject({ status: "new", score: null });
    expect(kit).toBeNull();
    expect(added.status).toBe("done");
    expect(added.note).toMatch(/^Its kit waits: .*monthly budget.*Prepare kit/);
  });

  it("makes the kit on a plan's agent whatever the budget", async () => {
    store.monthlyUsd = 0.0015;
    store.engine = "claude_code";
    const { kit } = await addAndRun("https://jobs.ashbyhq.com/lattice/1a2b3c");
    expect(kit).not.toBeNull();
  });

  it("asks for a saved profile before making a kit", async () => {
    store.hasSnapshot = false;
    const { added, kit } = await addAndRun(
      "https://jobs.ashbyhq.com/lattice/1a2b3c",
    );
    expect(kit).toBeNull();
    expect(added.note).toBe(
      "Save your profile, then press Prepare kit on the role.",
    );
  });

  it("does nothing for a role that's no longer being read", async () => {
    const id = crypto.randomUUID();
    store.added.set(id, {
      id,
      url: "https://jobs.ashbyhq.com/lattice/1a2b3c",
      text: "",
      status: "failed",
      note: "Couldn't start.",
      jobId: null,
    });
    expect(await readAddedStep(id)).toEqual({ kind: "stopped" });
    expect(store.pageReads).toEqual([]);
  });
});
