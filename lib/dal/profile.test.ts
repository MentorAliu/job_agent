import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { file, profile, profileSnapshot } from "@/db/schema";
import {
  cvExtractionSchema,
  toMasterProfile,
  type Answers,
  type MasterProfile,
} from "@/lib/schemas/profile";
import recorded from "@/test/fixtures/claude/parse-cv-response.json";

// A fake Drizzle client that records inserts. Only the query shapes these
// functions use are implemented.
type Insert = { table: unknown; values: unknown; set?: unknown };
let inserts: Insert[] = [];
let selectRows: unknown[] = [];
let failInsert = false;

type Rows = Promise<unknown[]> & { for: () => Promise<unknown[]> };
type FakeDb = {
  select: () => { from: () => { where: () => Rows } };
  insert: (table: unknown) => {
    values: (values: unknown) => Promise<void> & {
      onConflictDoUpdate: (config: { set: unknown }) => Promise<void>;
      returning: () => Promise<{ id: string }[]>;
    };
  };
  transaction: <T>(run: (tx: FakeDb) => Promise<T>) => Promise<T>;
};

const fakeDb: FakeDb = {
  select: () => ({
    from: () => ({
      where: () => {
        const rows = Promise.resolve(selectRows);
        return Object.assign(rows, { for: () => rows });
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      if (failInsert) throw new Error("insert failed");
      const entry: Insert = { table, values };
      inserts.push(entry);
      const done = Promise.resolve();
      return Object.assign(done, {
        onConflictDoUpdate: async ({ set }: { set: unknown }) => {
          entry.set = set;
        },
        returning: async () => [{ id: "snap-1" }],
      });
    },
  }),
  transaction: async <T>(run: (tx: typeof fakeDb) => Promise<T>) => run(fakeDb),
};

const getCurrentUser = vi.fn(async () => ({
  id: "u1",
  email: "owner@example.com",
  name: "Owner",
}));
const storage = {
  put: vi.fn(async (key: string, bytes: Uint8Array) => {
    void key;
    void bytes;
  }),
  get: vi.fn(),
  delete: vi.fn(async () => {}),
};

vi.mock("./db", () => ({ db: fakeDb }));
vi.mock("./session", () => ({
  getCurrentUser: () => getCurrentUser(),
}));
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));

const {
  createCvUpload,
  getProfileName,
  SavedAnswersError,
  saveProfileData,
  saveStandardAnswer,
  UnknownCvUploadError,
} = await import("./profile");

const CV_FILE_ID = "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

function draft(): MasterProfile {
  const text = recorded.body.content[0].text;
  return toMasterProfile(cvExtractionSchema.parse(JSON.parse(text)));
}

beforeEach(() => {
  inserts = [];
  selectRows = [];
  failInsert = false;
  getCurrentUser.mockClear();
  storage.put.mockClear();
  storage.delete.mockClear();
});

describe("saveProfileData", () => {
  it("saves the profile and a snapshot of the same data", async () => {
    selectRows = [{ id: CV_FILE_ID }];
    const data = draft();

    await expect(saveProfileData(data, CV_FILE_ID)).resolves.toEqual({
      snapshotId: "snap-1",
    });

    expect(inserts.map((insert) => insert.table)).toEqual([
      profile,
      profileSnapshot,
    ]);
    expect(inserts[0].values).toMatchObject({
      id: 1,
      data,
      cvFileId: CV_FILE_ID,
    });
    expect(inserts[0].set).toMatchObject({ data, cvFileId: CV_FILE_ID });
    expect(inserts[1].values).toEqual({ profileData: data });
  });

  it("keeps the current CV when saved without one", async () => {
    await saveProfileData(draft(), null);
    expect(inserts[0].set).not.toHaveProperty("cvFileId");
    expect(inserts).toHaveLength(2);
  });

  it("refuses a CV upload that doesn't exist or wasn't read", async () => {
    selectRows = [];
    await expect(saveProfileData(draft(), CV_FILE_ID)).rejects.toBeInstanceOf(
      UnknownCvUploadError,
    );
    expect(inserts).toHaveLength(0);
  });

  it("checks the session before touching data", async () => {
    getCurrentUser.mockRejectedValueOnce(new Error("Not signed in."));
    await expect(saveProfileData(draft(), null)).rejects.toThrow(
      "Not signed in.",
    );
    expect(inserts).toHaveLength(0);
  });
});

describe("createCvUpload", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 fake");

  it("stores the bytes and records the upload as waiting to be read", async () => {
    const { id } = await createCvUpload({
      bytes,
      mime: "application/pdf",
      originalName: "Jordan Sample CV.pdf",
    });

    expect(storage.put).toHaveBeenCalledWith(`cv/${id}.pdf`, bytes);
    expect(inserts[0].table).toBe(file);
    expect(inserts[0].values).toEqual({
      id,
      kind: "cv_upload",
      storageKey: `cv/${id}.pdf`,
      mime: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      originalName: "Jordan Sample CV.pdf",
      parseStatus: "pending",
    });
  });

  it("removes the stored file when the database insert fails", async () => {
    failInsert = true;
    await expect(
      createCvUpload({
        bytes,
        mime: "application/pdf",
        originalName: "cv.pdf",
      }),
    ).rejects.toThrow("insert failed");
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
  });
});

describe("getProfileName", () => {
  it("is the name on the saved profile, trimmed", async () => {
    selectRows = [{ name: "  Jordan Sample " }];
    await expect(getProfileName()).resolves.toBe("Jordan Sample");
    expect(getCurrentUser).toHaveBeenCalled();
  });

  it("is null until a profile with a name is saved", async () => {
    await expect(getProfileName()).resolves.toBeNull();
    selectRows = [{ name: null }];
    await expect(getProfileName()).resolves.toBeNull();
    selectRows = [{ name: "   " }];
    await expect(getProfileName()).resolves.toBeNull();
  });
});

describe("saveStandardAnswer", () => {
  const answers: Answers = {
    noticePeriod: "One month",
    workAuthorization: "",
    links: { linkedin: "", github: "", portfolio: "" },
    extra: [
      {
        id: "qa_salary01",
        question: "What are your salary expectations?",
        answer: "EUR 70K a year",
      },
    ],
  };
  const savedExtra = () =>
    (inserts[0]?.set as { answers: Answers } | undefined)?.answers.extra;

  it("adds a question Claude left to the owner", async () => {
    selectRows = [{ answers }];
    await saveStandardAnswer({
      question: "When could you start?",
      answer: "A month after an offer.",
    });
    expect(inserts[0].table).toBe(profile);
    expect(savedExtra()).toEqual([
      answers.extra[0],
      {
        id: expect.stringMatching(/^qa_[a-z0-9]{8}$/),
        question: "When could you start?",
        answer: "A month after an offer.",
      },
    ]);
  });

  it("answers a saved question again, whatever its case and spacing", async () => {
    selectRows = [{ answers }];
    await saveStandardAnswer({
      question: "what are your  salary expectations?",
      answer: "EUR 75K a year",
    });
    expect(savedExtra()).toEqual([
      { ...answers.extra[0], answer: "EUR 75K a year" },
    ]);
  });

  it("starts the standard answers when there are none yet", async () => {
    await saveStandardAnswer({ question: "Why us?", answer: "The product." });
    expect(savedExtra()).toHaveLength(1);
  });

  it("says so when the standard answers are full", async () => {
    selectRows = [
      {
        answers: {
          ...answers,
          extra: Array.from({ length: 50 }, (_, index) => ({
            id: `qa_${String(index).padStart(8, "0")}`,
            question: `Question ${index}?`,
            answer: "Yes.",
          })),
        },
      },
    ];
    await expect(
      saveStandardAnswer({ question: "One more?", answer: "No room." }),
    ).rejects.toThrow(SavedAnswersError);
    expect(inserts).toHaveLength(0);
  });
});
