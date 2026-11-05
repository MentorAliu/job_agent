import { beforeEach, describe, expect, it, vi } from "vitest";

import { document, job, profile, profileSnapshot } from "@/db/schema";
import { CvEditError } from "@/lib/cvs/editor";
import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import {
  tailorOutputSchema,
  type ClaimCheck,
  type CvContent,
} from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import tailored from "@/test/fixtures/claude/tailor-response.json";
import profileJson from "@/test/fixtures/profile.json";

// A fake Drizzle client: every select resolves to the rows set for the
// table it reads first, whatever joins and filters follow. Inserts and
// updates are recorded.
const rows = new Map<unknown, unknown[]>();
let inserts: { table: unknown; values: unknown }[] = [];
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
  insert: (table: unknown) => ({
    values: async (values: unknown) => {
      inserts.push({ table, values });
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        updates.push({ table, values });
      },
    }),
  }),
  execute: async () => {},
  transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(fakeDb),
};

vi.mock("./db", () => ({ db: fakeDb }));
vi.mock("./session", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));

const { addSkillsToKitCv } = await import("./cv-editor");

const DOC_ID = "6d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const SNAPSHOT_ID = "0b7a2f6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

const master: MasterProfile = masterProfileSchema.parse(profileJson);
// Added to the profile after the kit's CV was written.
const now: MasterProfile = {
  ...master,
  skills: [
    ...master.skills,
    { id: "skill_00000099", name: "GraphQL", category: "Backend" },
  ],
};

const [written] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv"],
  master,
  factIndex(profileFacts(master, null)),
);
const content = written.content as CvContent;
const claimFlags: ClaimCheck = {
  flags: [
    ...written.flags,
    {
      itemId: "role_00000005:2",
      kind: "unsupported",
      reason: "Mentored 3, didn't lead 12.",
      text: "Led a team of 12 engineers through the dashboard rebuild.",
    },
  ],
  checkedAt: "2026-10-18T10:00:00.000Z",
  checkError: null,
};

function kitCv(overrides: Record<string, unknown> = {}) {
  return {
    content,
    claimFlags,
    jobId: JOB_ID,
    title: "Senior Frontend Engineer",
    company: "Northwind Labs",
    status: "ready",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rows.clear();
  inserts = [];
  updates = [];
  rows.set(profile, [{ data: now }]);
  rows.set(profileSnapshot, [{ id: SNAPSHOT_ID, data: now }]);
  rows.set(document, [kitCv()]);
  rows.set(job, [{ tailoring: null }]);
});

describe("addSkillsToKitCv", () => {
  it("saves the kit's next CV with the skills added and nothing else changed", async () => {
    const saved = await addSkillsToKitCv(DOC_ID, [
      "skill_00000099",
      "skill_00000030",
    ]);
    expect(saved).toMatchObject({ kind: "kit", jobId: JOB_ID });

    const [insert] = inserts;
    expect(insert?.table).toBe(document);
    const next = insert?.values as {
      version: number;
      edited: boolean;
      content: CvContent;
    };
    expect(next.version).toBe(2);
    expect(next.edited).toBe(true);
    expect(next.content.skillIds).toEqual([
      ...content.skillIds,
      "skill_00000099",
      "skill_00000030",
    ]);
    // The same lines, less the two that didn't check out.
    const lines = (cv: CvContent) =>
      cv.experience.flatMap((entry) => entry.highlights.map((h) => h.text));
    expect(lines(next.content)).toEqual(
      lines(content).filter(
        (text) => !claimFlags.flags.some((flag) => flag.text === text),
      ),
    );
    expect(next.content.summary).toEqual(content.summary);
    // The kit follows the new version while its PDF is drawn.
    expect(updates).toEqual([
      {
        table: job,
        values: {
          tailoring: expect.objectContaining({
            requestId: saved.kind === "kit" ? saved.requestId : "",
            kinds: ["cv"],
            edit: true,
          }),
        },
      },
    ]);
  });

  it("refuses skills the CV lists already, or the profile doesn't have", async () => {
    await expect(
      addSkillsToKitCv(DOC_ID, ["skill_00000021", "skill_00000777"]),
    ).rejects.toThrow("Those skills are on this CV already.");
    expect(inserts).toEqual([]);
  });

  it("leaves a CV that went out with the application as it was sent", async () => {
    rows.set(document, [kitCv({ status: "applied" })]);
    await expect(addSkillsToKitCv(DOC_ID, ["skill_00000099"])).rejects.toThrow(
      CvEditError,
    );
    expect(inserts).toEqual([]);
  });

  it("sends the owner to Edit when a line's facts left the profile", async () => {
    const without: MasterProfile = {
      ...now,
      experience: now.experience.map((role) => ({
        ...role,
        highlights: role.highlights.filter(
          (highlight) => highlight.id !== "hl_00000011",
        ),
      })),
    };
    rows.set(profile, [{ data: without }]);
    await expect(addSkillsToKitCv(DOC_ID, ["skill_00000099"])).rejects.toThrow(
      /Use Edit to choose what it shows/,
    );
    expect(inserts).toEqual([]);
  });
});
