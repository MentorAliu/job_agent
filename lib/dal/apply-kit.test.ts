import { beforeEach, describe, expect, it, vi } from "vitest";

import { document, job, llmCall, profile, profileSnapshot } from "@/db/schema";
import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import {
  tailorOutputSchema,
  type ClaimCheck,
  type TailorState,
} from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import tailored from "@/test/fixtures/claude/tailor-response.json";
import profileJson from "@/test/fixtures/profile.json";

// A fake Drizzle client: every select resolves to the rows set for the
// table it reads first, whatever joins and filters follow. Updates are
// recorded.
const rows = new Map<unknown, unknown[]>();
let updates: { table: unknown; values: unknown }[] = [];

function chain(table: unknown) {
  const result = () => Promise.resolve(rows.get(table) ?? []);
  const self: Record<string, unknown> = {
    then: (resolve: (value: unknown[]) => unknown, reject: () => unknown) =>
      result().then(resolve, reject),
  };
  for (const method of [
    "leftJoin",
    "innerJoin",
    "where",
    "orderBy",
    "limit",
    "for",
  ]) {
    self[method] = () => self;
  }
  return self;
}

const fakeDb = {
  select: () => ({ from: (table: unknown) => chain(table) }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        updates.push({ table, values });
      },
    }),
  }),
  transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(fakeDb),
};

vi.mock("./db", () => ({ db: fakeDb }));
vi.mock("./session", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));

const { getApplyKit, requestTailoring, TailorRequestError } =
  await import("./apply-kit");

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const SNAPSHOT_ID = "0b7a2f6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const master: MasterProfile = masterProfileSchema.parse(profileJson);

const AI_POLICY = "Please don't use AI tools to write your answers.";

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    title: "Senior Frontend Engineer",
    company: "Northwind Labs",
    url: "https://boards.greenhouse.io/northwindlabs/jobs/4012345",
    applyUrl: null,
    status: "ready",
    score: 86,
    facts: {
      aiPolicy: AI_POLICY,
      applicationRules: ["Send a CV and a short cover letter."],
      deadline: "",
      location: {
        workplace: "remote",
        quote: "Remote within Europe.",
        allowed: ["Europe"],
        placesAre: "allowed",
      },
      salary: { min: 60000, max: 72000, currency: "EUR", period: "year" },
    },
    followUpOn: null,
    brief: null,
    tailoring: null,
    appliedAt: null,
    sentIds: [null, null, null],
    ...overrides,
  };
}

/** The recorded tailoring, stored as ready documents with Claude's flag added. */
function storedDocuments() {
  const facts = factIndex(profileFacts(master, null));
  const docs = toDocuments(
    tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
    ["cv", "cover_letter", "answers"],
    master,
    facts,
  );
  return docs.map((doc, index) => {
    const claimFlags: ClaimCheck = {
      flags:
        doc.kind === "cv"
          ? [
              ...doc.flags,
              {
                itemId: "role_00000005:2",
                kind: "unsupported",
                reason: "Mentored 3, didn't lead 12.",
                text: "Led a team of 12 engineers through the dashboard rebuild.",
              },
            ]
          : doc.flags,
      checkedAt: "2026-10-18T10:00:00.000Z",
      checkError: null,
    };
    return {
      id: `doc-${doc.kind}`,
      kind: doc.kind,
      version: 1 + index,
      content: doc.content,
      claimFlags,
      snapshotId: SNAPSHOT_ID,
      note: null,
      readyAt: new Date("2026-10-18T10:00:00Z"),
      pdfFileId: doc.kind === "answers" ? null : `file-${doc.kind}`,
    };
  });
}

beforeEach(() => {
  rows.clear();
  updates = [];
});

describe("getApplyKit", () => {
  it("shows the posting's rule on AI use", async () => {
    rows.set(job, [roleRow()]);
    const kit = await getApplyKit(JOB_ID);
    expect(kit?.job.aiPolicy).toBe(AI_POLICY);
    expect(kit?.job.applicationRules).toEqual([
      "Send a CV and a short cover letter.",
    ]);

    rows.set(job, [
      roleRow({
        facts: { ...roleRow().facts, aiPolicy: "", applicationRules: [] },
      }),
    ]);
    expect((await getApplyKit(JOB_ID))?.job.aiPolicy).toBeNull();
  });

  it("carries the facts the header shows, and what the kit has cost", async () => {
    rows.set(job, [roleRow()]);
    rows.set(llmCall, [{ costUsd: 0.113 }]);
    const kit = await getApplyKit(JOB_ID);
    expect(kit?.job).toMatchObject({
      score: 86,
      workplace: "remote",
      places: ["Europe"],
      salary: { min: 60000, max: 72000, currency: "EUR", period: "year" },
    });
    expect(kit?.costUsd).toBe(0.113);

    rows.delete(llmCall);
    expect((await getApplyKit(JOB_ID))?.costUsd).toBe(0);
  });

  it("fills an answer left to the owner with one they've saved since", async () => {
    rows.set(job, [roleRow()]);
    rows.set(document, storedDocuments());
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    rows.set(profile, [
      {
        data: master,
        answers: {
          noticePeriod: "",
          workAuthorization: "",
          links: { linkedin: "", github: "", portfolio: "" },
          extra: [
            {
              id: "qa_notice01",
              question: "what is your notice period?",
              answer: "One month.",
            },
          ],
        },
      },
    ]);
    const items = (await getApplyKit(JOB_ID))?.answers?.items ?? [];
    expect(items[2]).toMatchObject({
      question: "What is your notice period?",
      answer: "One month.",
      missing: "",
      fromStandard: true,
    });
    // The one about sponsorship is still the owner's to answer.
    expect(items[3]).toMatchObject({ answer: "", fromStandard: false });
  });

  it("puts the owner's saved answer in place of one that didn't check out", async () => {
    const flag = {
      itemId: "a1",
      kind: "unsupported" as const,
      reason: "The profile shows six years.",
      text: "About seven years of frontend work.",
    };
    rows.set(job, [roleRow()]);
    rows.set(
      document,
      storedDocuments().map((doc) =>
        doc.kind === "answers"
          ? { ...doc, claimFlags: { ...doc.claimFlags, flags: [flag] } }
          : doc,
      ),
    );
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    rows.set(profile, [{ data: master, answers: null }]);

    const flagged = (await getApplyKit(JOB_ID))?.answers?.items[1];
    expect(flagged).toMatchObject({ flag, fromStandard: false });

    rows.set(profile, [
      {
        data: master,
        answers: {
          noticePeriod: "",
          workAuthorization: "",
          links: { linkedin: "", github: "", portfolio: "" },
          extra: [
            {
              id: "qa_years001",
              question: flagged?.question ?? "",
              answer: "Six years of React, four of TypeScript.",
            },
          ],
        },
      },
    ]);
    expect((await getApplyKit(JOB_ID))?.answers?.items[1]).toMatchObject({
      answer: "Six years of React, four of TypeScript.",
      flag: null,
      fromStandard: true,
    });
  });

  it("builds the documents as sent, with both planted claims left out", async () => {
    rows.set(job, [roleRow()]);
    rows.set(document, storedDocuments());
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    rows.set(profile, [
      {
        data: master,
        answers: {
          noticePeriod: "",
          workAuthorization: "",
          links: {
            linkedin: "https://linkedin.com/in/jordan",
            github: "",
            portfolio: "",
          },
          extra: [],
        },
      },
    ]);
    const kit = await getApplyKit(JOB_ID);

    const cv = JSON.stringify(kit?.cv?.view);
    expect(cv).not.toContain("GraphQL");
    expect(cv).not.toContain("team of 12");
    expect(kit?.cv?.document).toMatchObject({
      version: 1,
      pdfUrl: "/api/documents/doc-cv/pdf",
    });
    expect(kit?.cv?.document.flags.map((flag) => flag.kind)).toEqual([
      "unknown_source",
      "unsupported",
    ]);
    expect(kit?.letter?.text).toMatch(/^Dear Northwind Labs hiring team,/);
    expect(kit?.answers?.document.pdfUrl).toBeNull();
    // The saved LinkedIn first, then the profile's GitHub and portfolio.
    expect(
      kit?.standardAnswers.filter(({ label }) =>
        ["LinkedIn", "GitHub", "Portfolio"].includes(label),
      ),
    ).toEqual([
      { label: "LinkedIn", value: "https://linkedin.com/in/jordan" },
      { label: "GitHub", value: "https://github.com/jordansample" },
      { label: "Portfolio", value: "https://jordansample.dev" },
    ]);
    expect(kit?.missingAnswers).toEqual([
      "Notice period",
      "Work authorization",
    ]);
    // Drawn before the links were kept, so the profile's, as in their PDFs.
    const profileLinks = master.links.map(({ label, url }) => ({ label, url }));
    expect(kit?.cv?.view.links).toEqual(profileLinks);
    expect(kit?.letter?.view.links).toEqual(profileLinks);
  });

  it("checks the CV against the posting's keywords", async () => {
    rows.set(job, [
      roleRow({
        facts: { ...roleRow().facts, stack: ["React", "GraphQL"] },
        description: "Our app is in TypeScript, designed in Figma.",
      }),
    ]);
    rows.set(document, storedDocuments());
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    const kit = await getApplyKit(JOB_ID);
    expect(kit?.cv?.keywords).toEqual([
      { term: "React", onCv: true, inProfile: true },
      // Planted on the CV, but left out: the profile never says it.
      { term: "GraphQL", onCv: false, inProfile: false },
      { term: "TypeScript", onCv: true, inProfile: true },
      { term: "Figma", onCv: false, inProfile: true },
    ]);
  });

  it("checks the keywords against the profile as it is now", async () => {
    rows.set(job, [
      roleRow({
        facts: { ...roleRow().facts, stack: ["React", "GraphQL"] },
        description: "Our app is in TypeScript and Svelte.",
      }),
    ]);
    rows.set(document, storedDocuments());
    // The CV was written before the owner added GraphQL to the profile.
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    const now: MasterProfile = {
      ...master,
      skills: [
        ...master.skills,
        { id: "skill_00000099", name: "GraphQL", category: "Backend" },
      ],
    };
    rows.set(profile, [{ data: now, answers: null }]);
    const kit = await getApplyKit(JOB_ID);
    expect(kit?.cv?.keywords).toEqual([
      { term: "React", onCv: true, inProfile: true },
      // Still not on the CV, but the profile has it now.
      { term: "GraphQL", onCv: false, inProfile: true },
      { term: "TypeScript", onCv: true, inProfile: true },
      { term: "Svelte", onCv: false, inProfile: true },
    ]);
    expect(kit?.cv?.skillsToAdd).toEqual([
      { id: "skill_00000023", name: "Svelte" },
      { id: "skill_00000099", name: "GraphQL" },
    ]);
  });

  it("shows the links each PDF was drawn with", async () => {
    const drawn = [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/jordan-new" },
    ];
    rows.set(job, [roleRow()]);
    rows.set(
      document,
      storedDocuments().map((doc) => ({ ...doc, headerLinks: drawn })),
    );
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    rows.set(profile, [{ data: master, answers: null }]);
    const kit = await getApplyKit(JOB_ID);
    expect(kit?.cv?.view.links).toEqual(drawn);
    expect(kit?.letter?.view.links).toEqual(drawn);
  });

  it("lists the exact versions recorded as sent", async () => {
    rows.set(job, [
      roleRow({
        status: "applied",
        appliedAt: new Date("2026-10-18T12:00:00Z"),
        followUpOn: "2026-10-25",
        sentIds: ["doc-cv", "doc-cover_letter", null],
      }),
    ]);
    rows.set(document, storedDocuments());
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: master }]);
    expect((await getApplyKit(JOB_ID))?.application).toEqual({
      appliedAt: "2026-10-18T12:00:00.000Z",
      followUpOn: "2026-10-25",
      documents: [
        { kind: "cv", version: 1 },
        { kind: "cover_letter", version: 2 },
      ],
    });
  });

  it("reads a request the worker never finished as failed", async () => {
    const lost: TailorState = {
      requestId: "r1",
      kinds: ["cv", "cover_letter", "answers"],
      note: null,
      status: "queued",
      stage: "queued",
      error: null,
      requestedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      finishedAt: null,
    };
    rows.set(job, [roleRow({ tailoring: lost })]);
    expect((await getApplyKit(JOB_ID))?.tailoring).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/never finished/),
    });
  });
});

describe("requestTailoring", () => {
  const all = {
    jobId: JOB_ID,
    kinds: ["cv", "cover_letter", "answers"] as const,
  };

  it("queues a request for a shortlisted role, in document order", async () => {
    rows.set(job, [{ status: "shortlisted", tailoring: null }]);
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID }]);
    const requestId = await requestTailoring({
      jobId: JOB_ID,
      kinds: ["answers", "cv"],
      note: "Shorter.",
    });

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(updates).toEqual([
      {
        table: job,
        values: {
          tailoring: expect.objectContaining({
            requestId,
            kinds: ["cv", "answers"],
            note: "Shorter.",
            status: "queued",
          }),
        },
      },
    ]);
  });

  it("refuses a role that isn't shortlisted, or one already being tailored", async () => {
    rows.set(job, [{ status: "new", tailoring: null }]);
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID }]);
    await expect(
      requestTailoring({ ...all, kinds: [...all.kinds], note: "" }),
    ).rejects.toThrow("Shortlist the role before tailoring it.");

    rows.set(job, [
      {
        status: "ready",
        tailoring: {
          status: "running",
          requestedAt: new Date().toISOString(),
        },
      },
    ]);
    await expect(
      requestTailoring({ ...all, kinds: [...all.kinds], note: "" }),
    ).rejects.toBeInstanceOf(TailorRequestError);
    expect(updates).toEqual([]);
  });

  it("asks for a profile first", async () => {
    rows.set(job, [{ status: "shortlisted", tailoring: null }]);
    await expect(
      requestTailoring({ ...all, kinds: [...all.kinds], note: "" }),
    ).rejects.toThrow(/Save your profile first/);
  });

  it("on shortlisting, leaves a role that already has documents alone", async () => {
    rows.set(job, [{ status: "shortlisted", tailoring: null }]);
    rows.set(profileSnapshot, [{ id: SNAPSHOT_ID }]);
    rows.set(document, [{ id: "doc-cv" }]);
    expect(
      await requestTailoring(
        { ...all, kinds: [...all.kinds], note: "" },
        { firstOnly: true },
      ),
    ).toBeNull();
    expect(updates).toEqual([]);
  });
});
