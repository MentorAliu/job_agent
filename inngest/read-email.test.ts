import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetExceededError } from "@/lib/claude/budget";

// The database and Claude are faked; which roles go along with an email, and
// what gets saved, is the real code.
const PREZLY = "5a1f3b2c-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const RAMP = "0b0f5c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
// Applied to long ago, so it's past the applications Claude gets listed.
const LINEAR = "3e8d1c2b-4a5f-4b6c-9d7e-1f2a3b4c5d6e";
const EMAIL = "7c2d4e6f-1a3b-4c5d-8e9f-a0b1c2d3e4f5";

const role = (id: string, company: string) => ({
  id,
  company,
  title: "Senior Frontend Engineer",
  status: "applied" as const,
  appliedAt: "2026-10-10T08:00:00Z",
  earlier: [],
});

const db = vi.hoisted(() => ({
  email: null as null | {
    id: string;
    jobId: string | null;
    body: string;
    status: "reading" | "done" | "failed";
  },
  roleQueries: [] as { jobIds: string[] | null; earlier: boolean }[],
  saved: [] as { emailId: string; jobId: string | null }[],
}));

vi.mock("@/lib/pipeline/emails", () => ({
  getPastedEmail: async () => db.email && { ...db.email },
  getEmailCandidate: async () => ({
    name: "Jordan Sample",
    headline: "",
    location: "Podgorica",
    timeZone: "Europe/Belgrade",
    noticePeriod: "",
    workAuthorization: "",
    links: [],
    experience: [],
    skills: [],
  }),
  getAppliedCompanies: async () => [
    { id: PREZLY, company: "Prezly" },
    { id: RAMP, company: "Ramp" },
    { id: LINEAR, company: "Linear" },
  ],
  getEmailRoles: async (query: {
    jobIds: string[] | null;
    earlier: boolean;
  }) => {
    db.roleQueries.push({ jobIds: query.jobIds, earlier: query.earlier });
    const listed = [role(PREZLY, "Prezly"), role(RAMP, "Ramp")];
    return query.jobIds
      ? [...listed, role(LINEAR, "Linear")].filter((entry) =>
          query.jobIds?.includes(entry.id),
        )
      : listed;
  },
  saveEmailReading: async (emailId: string, jobId: string | null) => {
    db.saved.push({ emailId, jobId });
    return { saved: true, jobId, movedTo: jobId ? "interviewing" : null };
  },
  markEmailFailed: async () => {},
  markUnanswered: async () => 0,
}));

const readEmail = vi.fn();
vi.mock("@/lib/claude/read-email", async () => ({
  ...(await vi.importActual<object>("@/lib/claude/read-email")),
  readEmail: (...args: unknown[]) => readEmail(...args),
}));

const { readEmailStep } = await import("./read-email");
const { ReadEmailError } = await import("@/lib/claude/read-email");

const reading = (jobId: string | null) => ({
  jobId,
  author: "employer",
  outcome: jobId ? "interview" : "unrelated",
  quote: "",
  sure: true,
  senderName: "Dana",
  subject: "",
  summary: "They'd like a call.",
  keyPoints: [],
  replyNeeded: true,
  reply: null,
  costUsd: 0.01,
});

describe("readEmailStep", () => {
  beforeEach(() => {
    db.email = null;
    db.roleQueries = [];
    db.saved = [];
    readEmail.mockReset();
  });

  it("reads an email pasted into a role with that role's earlier emails", async () => {
    db.email = {
      id: EMAIL,
      jobId: PREZLY,
      body: "Hi Jordan,\nCould you do a call next week?\n\n> On Monday you wrote:\n> Thanks!",
      status: "reading",
    };
    readEmail.mockResolvedValue(reading(PREZLY));

    expect(await readEmailStep(EMAIL)).toEqual({
      status: "read",
      jobId: PREZLY,
      outcome: "interview",
      movedTo: "interviewing",
    });
    expect(db.roleQueries).toEqual([{ jobIds: [PREZLY], earlier: true }]);
    const [, roles, email] = readEmail.mock.calls[0] as [
      unknown,
      { id: string }[],
      { newest: string; quoted: string },
    ];
    expect(roles.map((entry) => entry.id)).toEqual([PREZLY]);
    expect(email).toEqual({
      newest: "Hi Jordan,\nCould you do a call next week?",
      quoted: "On Monday you wrote:\nThanks!",
    });
    expect(db.saved).toEqual([{ emailId: EMAIL, jobId: PREZLY }]);
  });

  it("narrows an email pasted without a role to the companies it names", async () => {
    db.email = {
      id: EMAIL,
      jobId: null,
      body: "Thanks for applying to Ramp. We'd like to set up a call.",
      status: "reading",
    };
    readEmail.mockResolvedValue(reading(RAMP));

    await readEmailStep(EMAIL);
    expect(db.roleQueries).toEqual([{ jobIds: [RAMP], earlier: true }]);
    expect(db.saved).toEqual([{ emailId: EMAIL, jobId: RAMP }]);
  });

  it("finds a company applied to long ago, past the listed applications", async () => {
    db.email = {
      id: EMAIL,
      jobId: null,
      body: "Thank you for your interest in Linear. We've decided to move forward with other candidates.",
      status: "reading",
    };
    readEmail.mockResolvedValue(reading(LINEAR));

    await readEmailStep(EMAIL);
    expect(db.roleQueries).toEqual([{ jobIds: [LINEAR], earlier: true }]);
    const [, roles] = readEmail.mock.calls[0] as [unknown, { id: string }[]];
    expect(roles.map((entry) => entry.id)).toEqual([LINEAR]);
  });

  it("sends every application when the email names none of them", async () => {
    db.email = {
      id: EMAIL,
      jobId: null,
      body: "Thanks for your interest in the role. We'll be in touch.",
      status: "reading",
    };
    readEmail.mockResolvedValue(reading(null));

    expect(await readEmailStep(EMAIL)).toMatchObject({
      status: "read",
      jobId: null,
      outcome: "unrelated",
    });
    expect(db.roleQueries).toEqual([{ jobIds: null, earlier: false }]);
    const [, roles] = readEmail.mock.calls[0] as [unknown, { id: string }[]];
    expect(roles.map((entry) => entry.id)).toEqual([PREZLY, RAMP]);
  });

  it("skips an email that's already read, so a retry writes nothing twice", async () => {
    db.email = { id: EMAIL, jobId: PREZLY, body: "Hi", status: "done" };
    expect(await readEmailStep(EMAIL)).toEqual({
      status: "skipped",
      reason: "The email is done.",
    });
    expect(readEmail).not.toHaveBeenCalled();
  });

  it("stops without retrying when Claude can't read it or the budget is spent", async () => {
    db.email = { id: EMAIL, jobId: PREZLY, body: "Hi", status: "reading" };
    readEmail.mockRejectedValueOnce(new ReadEmailError("Couldn't read it."));
    await expect(readEmailStep(EMAIL)).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    readEmail.mockRejectedValueOnce(
      new BudgetExceededError("monthly", "The monthly budget is spent."),
    );
    await expect(readEmailStep(EMAIL)).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    readEmail.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(readEmailStep(EMAIL)).rejects.not.toBeInstanceOf(
      NonRetriableError,
    );
    expect(db.saved).toEqual([]);
  });
});
