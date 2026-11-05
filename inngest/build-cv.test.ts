import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetExceededError } from "@/lib/claude/budget";
import type { CvView } from "@/lib/documents/view";
import type { CvBuild } from "@/lib/pipeline/cvs";
import type { BuiltCvStatus, CvBuildRequest } from "@/lib/schemas/cv-builder";
import {
  masterProfileSchema,
  type Answers,
  type MasterProfile,
} from "@/lib/schemas/profile";
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_STAGE_MODELS,
  type LlmStage,
} from "@/lib/schemas/settings";
import type { ClaimCheck, CvContent } from "@/lib/schemas/tailor";
import built from "@/test/fixtures/claude/build-cv-response.json";
import claimCheck from "@/test/fixtures/claude/claim-check-response.json";
import profileJson from "@/test/fixtures/profile.json";
import { fakeAnthropic, type RecordedResponse } from "@/test/fake-anthropic";
import { samplePreferences } from "@/test/sample-preferences";

// Building a CV end to end, with the database replaced by an in-memory row
// and Claude by recorded responses. The citation check, the Claude modules'
// parsing and the PDF renderer are the real ones.

type StoredBuild = CvBuild & {
  error: string | null;
  pdf: Uint8Array | null;
  pageCount: number | null;
  trimmed: number;
};

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const SNAPSHOT_ID = "0b7a2f6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";

const store = {
  build: null as StoredBuild | null,
  answers: null as Answers | null,
  calls: [] as { stage: string; link: object }[],
  client: null as ReturnType<typeof fakeAnthropic> | null,
  rendered: [] as CvView[],
};

vi.mock("@/lib/claude/client", () => ({
  getAnthropic: () => store.client!.client,
}));

function respond(responses: RecordedResponse[]) {
  store.client = fakeAnthropic(responses);
}
const requests = () => store.client!.requests;

vi.mock("@/lib/claude/llm-call", () => ({
  getStageSetup: async (stage: LlmStage) => {
    const model = DEFAULT_STAGE_MODELS[stage];
    return {
      stage,
      model,
      price: DEFAULT_PRICE_TABLE.models[model],
      webSearchPer1k: 10,
    };
  },
  recordLlmCall: async (
    setup: { stage: string },
    _usage: unknown,
    _requestId: string | null,
    link: object = {},
  ) => {
    store.calls.push({ stage: setup.stage, link });
    return 0.01;
  },
}));

const assertWithinBudget = vi.fn(async (usd: number) => {
  void usd;
});
vi.mock("@/lib/claude/budget", async () => ({
  ...(await vi.importActual<object>("@/lib/claude/budget")),
  assertWithinBudget: (usd: number) => assertWithinBudget(usd),
}));

vi.mock("@/lib/documents/pdf", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documents/pdf")>(
    "@/lib/documents/pdf",
  );
  return {
    ...actual,
    renderCvPdf: async (view: CvView) => {
      store.rendered.push(view);
      return actual.renderCvPdf(view);
    },
  };
});

vi.mock("@/lib/pipeline/tailoring", () => ({
  getTailorInputs: async () => ({
    snapshotId: SNAPSHOT_ID,
    profile,
    answers: store.answers,
    preferences: samplePreferences,
  }),
  getSnapshotProfile: async (id: string) =>
    id === SNAPSHOT_ID ? profile : null,
}));

const GOING: BuiltCvStatus[] = ["writing", "checking", "rendering"];

vi.mock("@/lib/pipeline/cvs", () => ({
  getCvBuild: async (id: string) =>
    store.build?.id === id ? structuredClone(store.build) : null,
  saveCvContent: async (
    _id: string,
    content: CvContent,
    keywords: string[],
    claimFlags: ClaimCheck,
  ) => {
    if (store.build?.status !== "writing") return;
    Object.assign(store.build, {
      content,
      keywords,
      claimFlags,
      status: "checking",
    });
  },
  setCvClaimCheck: async (_id: string, claimFlags: ClaimCheck) => {
    if (!store.build || !GOING.includes(store.build.status)) return;
    Object.assign(store.build, { claimFlags, status: "rendering" });
  },
  saveCvPdf: async (
    _id: string,
    drawn: {
      content: CvContent;
      bytes: Uint8Array;
      pages: number;
      trimmed: number;
    },
  ) => {
    Object.assign(store.build!, {
      content: drawn.content,
      pdf: drawn.bytes,
      pageCount: drawn.pages,
      trimmed: drawn.trimmed,
      status: "ready",
    });
  },
  failCvBuild: async (_id: string, error: string) => {
    if (!store.build || !GOING.includes(store.build.status)) return;
    Object.assign(store.build, { status: "failed", error });
  },
}));

const { runCvBuild, writeStep } = await import("./build-cv");
const { UNCHECKED_MESSAGE } = await import("./tailor-job");

/** Inngest's step tools: runs each step once, JSON round trip included. */
function fakeStep() {
  const ids: string[] = [];
  const outputs: unknown[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      if (ids.includes(id)) throw new Error(`Step id ${id} used twice.`);
      ids.push(id);
      const value = await fn();
      const output =
        value === undefined ? null : JSON.parse(JSON.stringify(value));
      outputs.push(output);
      return output;
    },
  };
  return {
    step: step as unknown as Parameters<typeof runCvBuild>[1],
    ids,
    outputs,
  };
}

const request: CvBuildRequest = {
  targetTitle: "Lead Frontend Engineer",
  jobText: "We want React, TypeScript, Next.js and GraphQL.",
  skillIds: ["skill_00000021", "skill_00000017"],
  length: "one_page",
  sections: ["projects", "education", "certifications", "languages"],
  note: "",
};

function newBuild(patch: Partial<CvBuildRequest> = {}) {
  store.build = {
    id: CV_ID,
    request: { ...request, ...patch },
    snapshotId: SNAPSHOT_ID,
    status: "writing",
    content: null,
    keywords: null,
    claimFlags: null,
    error: null,
    pdf: null,
    pageCount: null,
    trimmed: 0,
  };
}

beforeEach(() => {
  store.answers = null;
  store.calls = [];
  store.rendered = [];
  assertWithinBudget.mockReset();
  newBuild();
});

describe("building a CV", () => {
  it("writes it, checks its claims and draws the PDF", async () => {
    respond([built, claimCheck]);
    const { step, ids, outputs } = fakeStep();

    expect(await runCvBuild({ cvId: CV_ID }, step)).toEqual({
      status: "ready",
    });
    expect(ids).toEqual(["write", "check-claims", "render"]);
    // A built CV is logged against no role.
    expect(store.calls).toEqual([
      { stage: "build_cv", link: {} },
      { stage: "claim_check", link: {} },
    ]);

    const cv = store.build!;
    expect(cv.status).toBe("ready");
    expect(cv.keywords).toEqual([
      "React",
      "TypeScript",
      "Next.js",
      "Code reviews",
      "Jest",
      "Figma",
      "GraphQL",
      "Accessibility",
    ]);
    // The code flags the made-up source, Claude the "team of 12".
    expect(
      cv.claimFlags?.flags.map(({ itemId, kind }) => ({ itemId, kind })),
    ).toEqual([
      { itemId: "role_00000009:2", kind: "unknown_source" },
      { itemId: "role_00000005:2", kind: "unsupported" },
    ]);
    expect(cv.claimFlags?.checkedAt).not.toBeNull();
    expect(cv.claimFlags?.checkError).toBeNull();

    expect(new TextDecoder().decode(cv.pdf!.subarray(0, 5))).toBe("%PDF-");
    expect(cv.pageCount).toBe(1);
    expect(cv.trimmed).toBe(0);

    // Drawn under the target title, without the flagged claims.
    const [view] = store.rendered;
    expect(view.headline).toBe("Lead Frontend Engineer");
    expect(view.skills.slice(0, 2)).toEqual(["React", "TypeScript"]);
    const drawn = JSON.stringify(view);
    expect(drawn).not.toContain("GraphQL");
    expect(drawn).not.toContain("team of 12");
    expect(view.projects).toHaveLength(1);
    expect(view.languages).toHaveLength(2);
    expect(view.links).toEqual(
      profile.links.map(({ label, url }) => ({ label, url })),
    );

    // Inngest's step history holds no CV text.
    const history = JSON.stringify(outputs);
    expect(history).not.toContain("Northwind Analytics");
    expect(history).not.toContain("dashboard");
  });

  it("keeps no keywords without a posting, and only the sections asked for", async () => {
    newBuild({ jobText: "", sections: ["education"] });
    respond([built, claimCheck]);
    await runCvBuild({ cvId: CV_ID }, fakeStep().step);

    expect(store.build?.keywords).toEqual([]);
    const [view] = store.rendered;
    expect(view.projects).toEqual([]);
    expect(view.certifications).toEqual([]);
    expect(view.languages).toEqual([]);
    expect(view.education).toHaveLength(1);
  });

  it("draws the links saved in the standard answers in place of the profile's", async () => {
    store.answers = {
      noticePeriod: "",
      workAuthorization: "",
      links: {
        linkedin: "",
        github: "https://github.com/jordan-new",
        portfolio: "",
      },
      extra: [],
    };
    respond([built, claimCheck]);
    await runCvBuild({ cvId: CV_ID }, fakeStep().step);

    expect(store.rendered[0].links[0]).toEqual({
      label: "GitHub",
      url: "https://github.com/jordan-new",
    });
  });

  it("still makes the CV when Claude's check can't run, marked as unchecked", async () => {
    // The CV fits the budget; the check doesn't.
    assertWithinBudget
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new BudgetExceededError(
          "monthly",
          "This month's budget is spent.",
        );
      });
    respond([built]);
    await runCvBuild({ cvId: CV_ID }, fakeStep().step);

    const cv = store.build!;
    expect(cv.status).toBe("ready");
    expect(cv.claimFlags?.checkedAt).toBeNull();
    expect(cv.claimFlags?.checkError).toBe(
      `${UNCHECKED_MESSAGE} This month's budget is spent.`,
    );
    // The code check's flag still holds.
    expect(cv.claimFlags?.flags.map((flag) => flag.kind)).toEqual([
      "unknown_source",
    ]);
  });

  it("doesn't ask Claude again when a retried step finds the CV written", async () => {
    store.build!.status = "checking";
    respond([]);
    expect(await writeStep(CV_ID)).toBe(true);
    expect(requests()).toHaveLength(0);
  });

  it("skips a CV that's gone or already failed", async () => {
    respond([]);
    store.build!.status = "failed";
    const { step, ids } = fakeStep();
    expect(await runCvBuild({ cvId: CV_ID }, step)).toEqual({
      status: "skipped",
    });
    expect(ids).toEqual(["write"]);
    store.build = null;
    expect(await writeStep(CV_ID)).toBe(false);
  });

  it("ends without retrying when Claude declines", async () => {
    respond([{ ...built, body: { ...built.body, stop_reason: "refusal" } }]);
    const failure = writeStep(CV_ID);
    await expect(failure).rejects.toBeInstanceOf(NonRetriableError);
    await expect(failure).rejects.toThrow(/declined/);
    expect(store.build?.status).toBe("writing");
  });
});
