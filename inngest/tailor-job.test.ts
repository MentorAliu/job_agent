import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CvView, LetterView } from "@/lib/documents/view";
import type { SavedDocument, TailorJob } from "@/lib/pipeline/tailoring";
import {
  masterProfileSchema,
  type Answers,
  type HeaderLink,
  type MasterProfile,
} from "@/lib/schemas/profile";
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_STAGE_MODELS,
  type LlmStage,
} from "@/lib/schemas/settings";
import type {
  ClaimCheck,
  CompanyBrief,
  CvContent,
  DocumentContent,
  DocumentKind,
  TailorState,
} from "@/lib/schemas/tailor";
import type { TailoredDocument } from "@/lib/tailor/citations";
import claimCheck from "@/test/fixtures/claude/claim-check-response.json";
import snapshot from "@/test/fixtures/claude/company-snapshot-response.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";
import profileJson from "@/test/fixtures/profile.json";
import { fakeAnthropic, type RecordedResponse } from "@/test/fake-anthropic";
import { samplePreferences } from "@/test/sample-preferences";

// Tailoring end to end (steps 7–10), with the database replaced by an
// in-memory store and Claude by recorded responses. The citation check, the
// Claude modules' parsing and the PDF renderer are the real ones.

type StoredDocument = {
  id: string;
  jobId: string;
  kind: DocumentKind;
  version: number;
  content: DocumentContent;
  claimFlags: ClaimCheck | null;
  snapshotId: string;
  requestId: string;
  note: string | null;
  readyAt: Date | null;
  pdf: Uint8Array | null;
  headerLinks?: HeaderLink[];
};

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const SNAPSHOT_ID = "0b7a2f6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const JOB_ID = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";

const store = {
  job: null as TailorJob | null,
  hasProfile: true,
  answers: null as Answers | null,
  documents: [] as StoredDocument[],
  events: [] as { type: string; payload: unknown }[],
  calls: [] as { stage: string; jobId?: string }[],
  client: null as ReturnType<typeof fakeAnthropic> | null,
  /** The views each PDF was drawn from. */
  rendered: [] as (CvView | LetterView)[],
};

vi.mock("@/lib/claude/client", () => ({
  getAnthropic: () => store.client!.client,
}));

/** Claude answers with these responses, in order. */
function respond(responses: RecordedResponse[]) {
  store.client = fakeAnthropic(responses);
}
const requests = () => store.client!.requests;

vi.mock("@/lib/claude/llm-call", () => ({
  getStageSetup: async (stage: LlmStage, model?: string) => {
    const chosen = model ?? DEFAULT_STAGE_MODELS[stage];
    return {
      stage,
      model: chosen,
      price: DEFAULT_PRICE_TABLE.models[chosen],
      webSearchPer1k: 10,
    };
  },
  recordLlmCall: async (
    setup: { stage: string },
    _usage: unknown,
    _requestId: string | null,
    link: { jobId?: string },
  ) => {
    store.calls.push({ stage: setup.stage, jobId: link.jobId });
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
    renderCvPdf: async (view: CvView) => {
      store.rendered.push(view);
      return actual.renderCvPdf(view);
    },
    renderLetterPdf: async (view: LetterView, date: string) => {
      store.rendered.push(view);
      return actual.renderLetterPdf(view, date);
    },
  };
});

const own = (requestId: string) =>
  store.job?.tailoring?.requestId === requestId;

// The time zone setup saved, for the letter's date.
vi.mock("@/lib/pipeline/setup", () => ({
  readOwnerTimeZone: async () => "Europe/Belgrade",
}));

vi.mock("@/lib/pipeline/tailoring", () => ({
  getTailorJob: async () => structuredClone(store.job),
  updateTailorState: async (
    _jobId: string,
    requestId: string,
    patch: Partial<TailorState>,
  ) => {
    if (!store.job?.tailoring || !own(requestId)) return false;
    store.job.tailoring = { ...store.job.tailoring, ...patch };
    return true;
  },
  failTailoring: async (_jobId: string, requestId: string, error: string) => {
    const state = store.job?.tailoring;
    if (!state || !own(requestId)) return;
    if (state.status !== "queued" && state.status !== "running") return;
    store.job!.tailoring = { ...state, status: "failed", error };
  },
  saveCompanyBrief: async (_jobId: string, brief: CompanyBrief) => {
    store.job!.companyBrief = brief;
  },
  getTailorInputs: async () =>
    store.hasProfile
      ? {
          snapshotId: SNAPSHOT_ID,
          profile,
          answers: store.answers,
          preferences: samplePreferences,
        }
      : null,
  getSnapshotProfile: async (id: string) =>
    id === SNAPSHOT_ID ? profile : null,
  getLatestDocuments: async (jobId: string, kinds: DocumentKind[]) =>
    kinds.flatMap((kind) => {
      const latest = store.documents
        .filter((d) => d.jobId === jobId && d.kind === kind && d.readyAt)
        .sort((a, b) => b.version - a.version)[0];
      return latest ? [latest] : [];
    }),
  saveDocuments: async (
    jobId: string,
    requestId: string,
    snapshotId: string,
    note: string | null,
    documents: TailoredDocument[],
  ): Promise<SavedDocument[]> =>
    documents.map((doc) => {
      const existing = store.documents.find(
        (d) => d.requestId === requestId && d.kind === doc.kind,
      );
      if (existing) {
        return { id: existing.id, kind: doc.kind, version: existing.version };
      }
      const version =
        Math.max(
          0,
          ...store.documents
            .filter((d) => d.jobId === jobId && d.kind === doc.kind)
            .map((d) => d.version),
        ) + 1;
      const stored: StoredDocument = {
        id: crypto.randomUUID(),
        jobId,
        kind: doc.kind,
        version,
        content: doc.content,
        claimFlags: { flags: doc.flags, checkedAt: null, checkError: null },
        snapshotId,
        requestId,
        note,
        readyAt: null,
        pdf: null,
      };
      store.documents.push(stored);
      return { id: stored.id, kind: stored.kind, version };
    }),
  getRequestDocuments: async (requestId: string): Promise<SavedDocument[]> =>
    store.documents
      .filter((d) => d.requestId === requestId)
      .map(({ id, kind, version }) => ({ id, kind, version })),
  getDocuments: async (ids: string[]) =>
    store.documents.filter((d) => ids.includes(d.id)).map((d) => ({ ...d })),
  setClaimCheck: async (id: string, check: ClaimCheck) => {
    store.documents.find((d) => d.id === id)!.claimFlags = check;
  },
  saveDocumentPdf: async (
    _jobId: string,
    id: string,
    bytes: Uint8Array,
    headerLinks: HeaderLink[],
  ) => {
    Object.assign(
      store.documents.find((d) => d.id === id)!,
      {
        pdf: bytes,
        headerLinks,
      },
    );
  },
  finishTailoring: async (
    jobId: string,
    requestId: string,
    documents: SavedDocument[],
    note: string | null,
    edited = false,
  ) => {
    const fresh = store.documents.filter(
      (d) => documents.some((saved) => saved.id === d.id) && !d.readyAt,
    );
    for (const doc of fresh) doc.readyAt = new Date();
    if (fresh.length > 0) {
      store.events.push({
        type: "documents_ready",
        payload: {
          documents: documents.map(({ kind, version }) => ({ kind, version })),
          note,
          ...(edited ? { edited } : {}),
        },
      });
    }
    const role = store.job!;
    if (role.status === "shortlisted") {
      role.status = "ready";
      store.events.push({
        type: "status_changed",
        payload: { from: "shortlisted", to: "ready", reason: null },
      });
    }
    if (own(requestId)) {
      role.tailoring = {
        ...role.tailoring!,
        status: "succeeded",
        stage: "done",
        finishedAt: new Date().toISOString(),
      };
    }
    void jobId;
  },
}));

const {
  runTailoring,
  writeStep,
  missedLinesMessage,
  STOPPED_MESSAGES,
  UNCHECKED_MESSAGE,
} = await import("./tailor-job");

/** A stand-in for Inngest's step tools: runs each step once, JSON round trip included. */
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
    step: step as unknown as Parameters<typeof runTailoring>[1],
    ids,
    outputs,
  };
}

const modelInfo: RecordedResponse = {
  requestId: "req_models_haiku",
  body: {
    id: "claude-haiku-5-5",
    type: "model",
    display_name: "Claude Haiku 5.5",
    created_at: "2026-09-01T00:00:00Z",
    capabilities: {
      server_tools: {
        supported: true,
        web_search: { supported: true },
        code_execution: { supported: true },
      },
    },
  },
};

/** The tailor response with only the cover letter rewritten. */
function letterOnly(text: string): RecordedResponse {
  const output = JSON.parse(tailored.body.content[0].text);
  return {
    ...tailored,
    body: {
      ...tailored.body,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            cv: {
              summary: { text: "", sources: [] },
              experience: [],
              projects: [],
              skillIds: [],
            },
            coverLetter: {
              paragraphs: [
                { text, sources: ["hl_00000011"] },
                ...output.coverLetter.paragraphs.slice(1),
              ],
            },
            answers: [],
          }),
        },
      ],
    },
  };
}

function request(kinds: DocumentKind[], note: string | null = null): string {
  const requestId = crypto.randomUUID();
  store.job!.tailoring = {
    requestId,
    kinds,
    note,
    status: "queued",
    stage: "queued",
    error: null,
    requestedAt: new Date().toISOString(),
    finishedAt: null,
  };
  return requestId;
}

beforeEach(() => {
  store.job = {
    id: JOB_ID,
    title: "Senior Frontend Engineer",
    company: "Northwind Labs",
    url: "https://boards.greenhouse.io/northwindlabs/jobs/4012345",
    status: "shortlisted",
    facts: null,
    description: "We build analytics for freight teams.",
    companyBrief: null,
    tailoring: null,
  };
  store.hasProfile = true;
  store.answers = null;
  store.documents = [];
  store.events = [];
  store.calls = [];
  store.rendered = [];
  assertWithinBudget.mockReset();
});

describe("tailoring a shortlisted role", () => {
  it("writes the brief, the three documents and both PDFs, then moves the role to Ready", async () => {
    respond([modelInfo, snapshot, tailored, claimCheck]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    const { step, ids, outputs } = fakeStep();

    expect(await runTailoring({ jobId: JOB_ID, requestId }, step)).toEqual({
      status: "succeeded",
      documents: 3,
    });
    expect(ids).toEqual([
      "start",
      "company-snapshot",
      "write",
      "check-claims",
      "render",
    ]);
    expect(store.calls.map((call) => call.stage)).toEqual([
      "company_snapshot",
      "tailor",
      "claim_check",
    ]);
    expect(store.calls.every((call) => call.jobId === JOB_ID)).toBe(true);

    expect(store.job?.status).toBe("ready");
    expect(store.job?.tailoring).toMatchObject({
      status: "succeeded",
      stage: "done",
    });
    expect(store.job?.companyBrief?.sources).toHaveLength(2);
    expect(
      store.documents.map(({ kind, version, readyAt }) => ({
        kind,
        version,
        ready: readyAt !== null,
      })),
    ).toEqual([
      { kind: "cv", version: 1, ready: true },
      { kind: "cover_letter", version: 1, ready: true },
      { kind: "answers", version: 1, ready: true },
    ]);
    expect(store.events).toEqual([
      {
        type: "documents_ready",
        payload: {
          documents: [
            { kind: "cv", version: 1 },
            { kind: "cover_letter", version: 1 },
            { kind: "answers", version: 1 },
          ],
          note: null,
        },
      },
      {
        type: "status_changed",
        payload: { from: "shortlisted", to: "ready", reason: null },
      },
    ]);

    // PDFs for the CV and letter, none for the answers.
    const pdfs = store.documents.map((doc) =>
      doc.pdf ? new TextDecoder().decode(doc.pdf.subarray(0, 5)) : null,
    );
    expect(pdfs).toEqual(["%PDF-", "%PDF-", null]);
    // With no links in the standard answers, the profile's are drawn and kept.
    const profileLinks = profile.links.map(({ label, url }) => ({
      label,
      url,
    }));
    expect(store.rendered.map((view) => view.links)).toEqual([
      profileLinks,
      profileLinks,
    ]);
    expect(store.documents[0].headerLinks).toEqual(profileLinks);

    // Inngest's step history holds ids, never the owner's text.
    const history = JSON.stringify(outputs);
    expect(history).not.toContain("Northwind Analytics");
    expect(history).not.toContain("dashboard");
  });

  it("flags both planted claims and leaves them out of the PDF", async () => {
    respond([modelInfo, snapshot, tailored, claimCheck]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    await runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step);

    const cv = store.documents.find((doc) => doc.kind === "cv")!;
    expect(cv.claimFlags).toMatchObject({
      checkError: null,
      flags: [
        { itemId: "role_00000009:2", kind: "unknown_source" },
        { itemId: "role_00000005:2", kind: "unsupported" },
      ],
    });
    expect(cv.claimFlags?.checkedAt).not.toBeNull();

    // Claude's check only saw what the code check passed.
    const sent = JSON.stringify(requests().at(-1)?.body);
    expect(sent).toContain("team of 12");
    expect(sent).not.toContain("GraphQL");

    const drawn = JSON.stringify(store.rendered[0]);
    expect(drawn).toContain("Mentored 3 junior engineers");
    expect(drawn).not.toContain("team of 12");
    expect(drawn).not.toContain("GraphQL");
  });

  it("gives Claude the posting's keywords the profile backs", async () => {
    store.job!.description =
      "We build analytics for freight teams in React and TypeScript, with GraphQL.";
    respond([modelInfo, snapshot, tailored, claimCheck]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    await runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step);

    const prompt = requests()
      .map((sent) => sent.body as { messages?: { content: unknown }[] } | null)
      .map((body) => String(body?.messages?.[0]?.content ?? ""))
      .find((content) => content.includes("# What to write"));
    // GraphQL isn't in the profile, so it's never suggested.
    expect(prompt).toContain(
      "the profile states each of them: TypeScript, React.",
    );
  });

  it("still tailors when the company snapshot fails", async () => {
    respond([
      modelInfo,
      {
        requestId: "req_overloaded",
        status: 529,
        body: {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        },
      },
      tailored,
      claimCheck,
    ]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    const outcome = await runTailoring(
      { jobId: JOB_ID, requestId },
      fakeStep().step,
    );

    expect(outcome.status).toBe("succeeded");
    expect(store.job?.companyBrief).toBeNull();
    expect(store.job?.status).toBe("ready");
  });

  it("keeps the documents, marked unchecked, when Claude's claim check can't run", async () => {
    respond([
      modelInfo,
      snapshot,
      tailored,
      {
        ...claimCheck,
        body: { ...claimCheck.body, stop_reason: "max_tokens" },
      },
    ]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    await runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step);

    const cv = store.documents.find((doc) => doc.kind === "cv")!;
    expect(cv.claimFlags).toEqual({
      flags: [expect.objectContaining({ kind: "unknown_source" })],
      checkedAt: null,
      checkError: UNCHECKED_MESSAGE,
    });
    expect(cv.pdf).not.toBeNull();
    expect(store.job?.tailoring?.status).toBe("succeeded");
  });

  it("says which documents have lines Claude's check gave no verdict on", async () => {
    const answer = JSON.parse(claimCheck.body.content[0].text);
    answer.verdicts = answer.verdicts.filter(
      (verdict: { itemId: string }) => verdict.itemId !== "cover_letter/p3",
    );
    respond([
      modelInfo,
      snapshot,
      tailored,
      {
        ...claimCheck,
        body: {
          ...claimCheck.body,
          content: [{ type: "text", text: JSON.stringify(answer) }],
        },
      },
    ]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    await runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step);

    const checkErrors = store.documents.map((doc) => [
      doc.kind,
      doc.claimFlags?.checkError,
    ]);
    expect(checkErrors).toEqual([
      ["cv", null],
      ["cover_letter", missedLinesMessage(1)],
      ["answers", null],
    ]);
  });

  it("does nothing for a request a newer one replaced", async () => {
    const stale = request(["cv", "cover_letter", "answers"]);
    request(["cover_letter"], "Shorter.");
    const { step, ids } = fakeStep();

    expect(
      await runTailoring({ jobId: JOB_ID, requestId: stale }, step),
    ).toEqual({
      status: "skipped",
      reason: "A newer request replaced this one.",
    });
    expect(ids).toEqual(["start"]);
    expect(store.documents).toEqual([]);
  });

  it.each(["listing_closed", "removed"] as const)(
    "writes nothing for a role that became %s before it started",
    async (status) => {
      const requestId = request(["cv", "cover_letter", "answers"]);
      store.job!.status = status;
      const { step, ids } = fakeStep();
      const reason = STOPPED_MESSAGES[status];

      expect(await runTailoring({ jobId: JOB_ID, requestId }, step)).toEqual({
        status: "skipped",
        reason,
      });
      expect(ids).toEqual(["start"]);
      expect(store.job!.tailoring).toMatchObject({
        status: "failed",
        error: reason,
      });
      expect(store.documents).toEqual([]);
    },
  );

  it("fails without a retry when there's no profile to tailor from", async () => {
    store.hasProfile = false;
    respond([]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    store.job!.tailoring!.status = "running";

    const promise = writeStep(JOB_ID, requestId);
    await expect(promise).rejects.toBeInstanceOf(NonRetriableError);
    await expect(promise).rejects.toThrow(/Save your profile first/);
  });

  it("stops before writing anything when the monthly budget is spent", async () => {
    const { BudgetExceededError } = await import("@/lib/claude/budget");
    assertWithinBudget.mockRejectedValue(
      new BudgetExceededError("monthly", "This month's budget is spent."),
    );
    respond([modelInfo]);
    const requestId = request(["cv", "cover_letter", "answers"]);

    const promise = runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step);
    await expect(promise).rejects.toBeInstanceOf(NonRetriableError);
    await expect(promise).rejects.toThrow("This month's budget is spent.");
    expect(store.calls).toEqual([]);
    expect(store.documents).toEqual([]);
  });

  it("fails without a retry when the documents were cut off", async () => {
    respond([
      { ...tailored, body: { ...tailored.body, stop_reason: "max_tokens" } },
    ]);
    const requestId = request(["cv", "cover_letter", "answers"]);
    store.job!.tailoring!.status = "running";

    await expect(writeStep(JOB_ID, requestId)).rejects.toThrow(
      NonRetriableError,
    );
    expect(store.documents).toEqual([]);
  });
});

describe("regenerating one document with a note", () => {
  it("saves the next version from the current one, with no new brief, and keeps the role Ready", async () => {
    respond([modelInfo, snapshot, tailored, claimCheck]);
    await runTailoring(
      { jobId: JOB_ID, requestId: request(["cv", "cover_letter", "answers"]) },
      fakeStep().step,
    );
    store.events = [];

    const note = "Lead with the TypeScript migration.";
    respond([
      letterOnly(
        "I moved a 40k-line JavaScript codebase to TypeScript at Blue Harbor Software.",
      ),
      claimCheck,
    ]);
    const { step, ids } = fakeStep();
    await runTailoring(
      { jobId: JOB_ID, requestId: request(["cover_letter"], note) },
      step,
    );

    expect(ids).toEqual(["start", "write", "check-claims", "render"]);
    const letters = store.documents.filter((d) => d.kind === "cover_letter");
    expect(letters.map((d) => [d.version, d.note])).toEqual([
      [1, null],
      [2, note],
    ]);
    expect(store.documents.filter((d) => d.kind === "cv")).toHaveLength(1);

    // The current letter and the note go to Claude with the same cached
    // profile prefix.
    const tailorRequest = requests()[0].body as {
      system: { text: string }[];
      messages: { content: string }[];
    };
    const prompt = tailorRequest.messages[0].content;
    expect(prompt).toContain("Write only the cover letter.");
    expect(prompt).toContain("## The current version of the cover letter");
    expect(prompt).toContain(note);
    expect(tailorRequest.system[1].text).toContain("[hl_00000006]");
    // The time zones from the job preferences can be cited too.
    expect(tailorRequest.system[1].text).toContain(
      "[pref_timezone] Can work in the time zones: Europe/Belgrade (Central European Time",
    );

    expect(store.job?.status).toBe("ready");
    expect(store.events).toEqual([
      {
        type: "documents_ready",
        payload: { documents: [{ kind: "cover_letter", version: 2 }], note },
      },
    ]);
    const cv = store.documents.find((d) => d.kind === "cv")!;
    expect((cv.content as CvContent).experience).toHaveLength(3);
  });
});

describe("drawing the owner's edited CV", () => {
  /** Saves a version as the editor does, and asks for its PDF. */
  function saveEdit(content: CvContent): string {
    const requestId = request(["cv"]);
    store.job!.tailoring = { ...store.job!.tailoring!, edit: true };
    store.documents.push({
      id: crypto.randomUUID(),
      jobId: JOB_ID,
      kind: "cv",
      version: 2,
      content,
      claimFlags: { flags: [], checkedAt: null, checkError: null },
      snapshotId: SNAPSHOT_ID,
      requestId,
      note: null,
      readyAt: null,
      pdf: null,
    });
    return requestId;
  }

  it("draws the saved version's PDF with no Claude call, and keeps the role Ready", async () => {
    respond([modelInfo, snapshot, tailored, claimCheck]);
    await runTailoring(
      { jobId: JOB_ID, requestId: request(["cv", "cover_letter", "answers"]) },
      fakeStep().step,
    );
    store.events = [];
    store.calls = [];
    store.rendered = [];

    const first = store.documents.find((d) => d.kind === "cv")!;
    const content = structuredClone(first.content as CvContent);
    content.headline = "Frontend Lead";
    content.experience = content.experience.slice(0, 1);
    const requestId = saveEdit(content);
    respond([]);
    const { step, ids } = fakeStep();
    expect(await runTailoring({ jobId: JOB_ID, requestId }, step)).toEqual({
      status: "succeeded",
      documents: 1,
    });

    expect(ids).toEqual(["start", "find-edit", "render"]);
    expect(requests()).toHaveLength(0);
    expect(store.calls).toEqual([]);
    const edited = store.documents.find((d) => d.version === 2)!;
    expect(edited.pdf?.length).toBeGreaterThan(0);
    expect(edited.readyAt).not.toBeNull();
    expect(store.rendered).toHaveLength(1);
    const view = store.rendered[0] as CvView;
    expect(view.headline).toBe("Frontend Lead");
    expect(view.experience).toHaveLength(1);
    expect(store.events).toEqual([
      {
        type: "documents_ready",
        payload: {
          documents: [{ kind: "cv", version: 2 }],
          note: null,
          edited: true,
        },
      },
    ]);
    expect(store.job?.status).toBe("ready");
    expect(store.job?.tailoring?.status).toBe("succeeded");
  });

  it("draws the links saved in the standard answers in place of the profile's, and keeps them", async () => {
    store.answers = {
      noticePeriod: "",
      workAuthorization: "",
      links: {
        linkedin: "https://www.linkedin.com/in/jordan-new",
        github: "",
        portfolio: "",
      },
      extra: [],
    };
    saveEdit({
      kind: "cv",
      summary: null,
      experience: [],
      projects: [],
      skillIds: [],
    });
    respond([]);
    const { step } = fakeStep();
    await runTailoring(
      { jobId: JOB_ID, requestId: store.job!.tailoring!.requestId },
      step,
    );

    const links = [
      { label: "GitHub", url: "https://github.com/jordansample" },
      { label: "LinkedIn", url: "https://www.linkedin.com/in/jordan-new" },
      { label: "Portfolio", url: "https://jordansample.dev" },
    ];
    expect((store.rendered[0] as CvView).links).toEqual(links);
    expect(store.documents[0].headerLinks).toEqual(links);
  });

  it("fails without a retry when the saved version is gone", async () => {
    const requestId = request(["cv"]);
    store.job!.tailoring = { ...store.job!.tailoring!, edit: true };
    respond([]);
    await expect(
      runTailoring({ jobId: JOB_ID, requestId }, fakeStep().step),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});
