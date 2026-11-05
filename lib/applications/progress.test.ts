import { describe, expect, it } from "vitest";

import type { PastedEmailView } from "@/lib/dal/emails";
import type { TimelineEvent } from "@/lib/dal/jobs";
import type { JobStatus } from "@/lib/schemas/tracker";

import {
  applicationNow,
  applicationSteps,
  conversationItems,
  peopleWhoWrote,
  roleHref,
} from "./progress";

const APPLIED_AT = "2026-10-06T09:00:00.000Z";

function email(
  id: string,
  pastedAt: string,
  overrides: Partial<PastedEmailView> = {},
): PastedEmailView {
  return {
    id,
    jobId: "job",
    status: "done",
    error: null,
    author: "employer",
    outcome: "received",
    sure: true,
    quote: null,
    senderName: "Lena Hartmann",
    subject: null,
    summary: "Thanks for applying.",
    keyPoints: [],
    replyNeeded: false,
    reply: null,
    handledAt: null,
    body: "…",
    pastedAt,
    moved: null,
    ...overrides,
  };
}

function move(
  id: string,
  at: string,
  from: JobStatus,
  to: JobStatus,
  extra: { source?: "owner" | "email" | "no_reply"; emailId?: string } = {},
): TimelineEvent {
  return {
    id,
    at,
    type: "status_changed",
    payload: { from, to, reason: null, ...extra },
  };
}

const applying = move("e0", APPLIED_AT, "ready", "applied");

describe("roleHref", () => {
  it("opens an application's page once the role is applied to", () => {
    expect(roleHref({ id: "a", status: "interviewing" })).toBe(
      "/applications/a",
    );
    expect(roleHref({ id: "a", status: "no_response" })).toBe(
      "/applications/a",
    );
    expect(roleHref({ id: "a", status: "ready" })).toBe("/jobs/a");
  });
});

describe("applicationSteps", () => {
  it("starts at Applied until the company writes", () => {
    expect(
      applicationSteps({
        status: "applied",
        appliedAt: APPLIED_AT,
        emails: [],
        events: [applying],
      }),
    ).toEqual([
      { key: "applied", state: "now", at: APPLIED_AT },
      { key: "replied", state: "todo", at: null },
      { key: "interviewing", state: "todo", at: null },
      { key: "offer", state: "todo", at: null },
    ]);
  });

  it("dates each step: the first email, the move to Interviewing", () => {
    const steps = applicationSteps({
      status: "interviewing",
      appliedAt: APPLIED_AT,
      emails: [
        email("m2", "2026-10-14T10:00:00.000Z", { outcome: "interview" }),
        email("m1", "2026-10-07T10:00:00.000Z"),
      ],
      events: [
        move("e1", "2026-10-14T10:01:00.000Z", "applied", "interviewing", {
          source: "email",
          emailId: "m2",
        }),
        applying,
      ],
    });
    expect(steps).toEqual([
      { key: "applied", state: "done", at: APPLIED_AT },
      { key: "replied", state: "done", at: "2026-10-07T10:00:00.000Z" },
      { key: "interviewing", state: "now", at: "2026-10-14T10:01:00.000Z" },
      { key: "offer", state: "todo", at: null },
    ]);
  });

  it("leaves out emails still being read, and ones about something else", () => {
    const steps = applicationSteps({
      status: "applied",
      appliedAt: APPLIED_AT,
      emails: [
        email("m2", "2026-10-08T10:00:00.000Z", { status: "reading" }),
        email("m1", "2026-10-07T10:00:00.000Z", { outcome: "unrelated" }),
      ],
      events: [applying],
    });
    expect(steps[0]).toMatchObject({ key: "applied", state: "now" });
  });

  it("ends a closed role on how it closed, after the steps it reached", () => {
    const rejection = email("m2", "2026-10-20T10:00:00.000Z", {
      outcome: "rejected",
    });
    expect(
      applicationSteps({
        status: "rejected",
        appliedAt: APPLIED_AT,
        emails: [rejection],
        events: [
          move("e1", "2026-10-20T10:01:00.000Z", "applied", "rejected", {
            source: "email",
            emailId: "m2",
          }),
          applying,
        ],
      }),
    ).toEqual([
      // The rejection doesn't count as them replying.
      { key: "applied", state: "done", at: APPLIED_AT },
      { key: "rejected", state: "now", at: "2026-10-20T10:01:00.000Z" },
    ]);

    expect(
      applicationSteps({
        status: "rejected",
        appliedAt: APPLIED_AT,
        emails: [],
        events: [
          move("e2", "2026-10-21T10:00:00.000Z", "interviewing", "rejected"),
          move("e1", "2026-10-14T10:00:00.000Z", "applied", "interviewing"),
          applying,
        ],
      }).map((step) => [step.key, step.state]),
    ).toEqual([
      ["applied", "done"],
      ["replied", "done"],
      ["interviewing", "done"],
      ["rejected", "now"],
    ]);
  });
});

describe("applicationNow", () => {
  it("waits on the company after applying, until the role would close", () => {
    expect(
      applicationNow({
        status: "applied",
        appliedAt: APPLIED_AT,
        emails: [],
        events: [applying],
      }),
    ).toEqual({
      kind: "waiting",
      after: "applied",
      since: APPLIED_AT,
      email: null,
      closesAt: "2026-11-05T09:00:00.000Z",
    });
  });

  it("counts the 30 days again from the company's latest email", () => {
    const received = email("m1", "2026-10-07T10:00:00.000Z");
    expect(
      applicationNow({
        status: "applied",
        appliedAt: APPLIED_AT,
        emails: [received],
        events: [applying],
      }),
    ).toMatchObject({
      kind: "waiting",
      after: "they_wrote",
      since: "2026-10-07T10:00:00.000Z",
      email: received,
      closesAt: "2026-11-06T10:00:00.000Z",
    });
  });

  it("is the owner's turn while the company's latest email waits for a reply", () => {
    const invite = email("m2", "2026-10-14T10:00:00.000Z", {
      outcome: "interview",
      replyNeeded: true,
    });
    expect(
      applicationNow({
        status: "interviewing",
        appliedAt: APPLIED_AT,
        emails: [invite, email("m1", "2026-10-07T10:00:00.000Z")],
        events: [applying],
      }),
    ).toEqual({ kind: "reply", email: invite });
  });

  it("waits on them once the owner replied, by copying or by pasting the reply", () => {
    const handled = email("m2", "2026-10-14T10:00:00.000Z", {
      outcome: "interview",
      replyNeeded: true,
      handledAt: "2026-10-14T11:00:00.000Z",
      keyPoints: ["Thu 16 Oct, 14:00 CET"],
    });
    expect(
      applicationNow({
        status: "interviewing",
        appliedAt: APPLIED_AT,
        emails: [handled],
        events: [applying],
      }),
    ).toEqual({
      kind: "waiting",
      after: "you_replied",
      since: "2026-10-14T11:00:00.000Z",
      email: handled,
      // Only an applied role moves to No response by itself.
      closesAt: null,
    });

    const unhandled = { ...handled, handledAt: null };
    const pasted = email("m3", "2026-10-14T12:00:00.000Z", {
      author: "candidate",
      outcome: "other",
    });
    expect(
      applicationNow({
        status: "interviewing",
        appliedAt: APPLIED_AT,
        emails: [pasted, unhandled],
        events: [applying],
      }),
    ).toMatchObject({
      kind: "waiting",
      after: "you_replied",
      since: "2026-10-14T12:00:00.000Z",
      email: unhandled,
    });
  });

  it("ignores a newer email about something else", () => {
    const invite = email("m1", "2026-10-14T10:00:00.000Z", {
      outcome: "interview",
      replyNeeded: true,
    });
    expect(
      applicationNow({
        status: "interviewing",
        appliedAt: APPLIED_AT,
        emails: [
          email("m2", "2026-10-15T10:00:00.000Z", { outcome: "unrelated" }),
          invite,
        ],
        events: [applying],
      }),
    ).toEqual({ kind: "reply", email: invite });
  });

  it("shows the offer that made the move, once it asks nothing", () => {
    const offer = email("m2", "2026-10-31T10:00:00.000Z", {
      outcome: "offer",
      replyNeeded: true,
      handledAt: "2026-10-31T12:00:00.000Z",
    });
    expect(
      applicationNow({
        status: "offer",
        appliedAt: APPLIED_AT,
        emails: [offer],
        events: [
          move("e1", "2026-10-31T10:01:00.000Z", "interviewing", "offer", {
            source: "email",
            emailId: "m2",
          }),
          applying,
        ],
      }),
    ).toEqual({
      kind: "offer",
      email: offer,
      since: "2026-10-31T10:01:00.000Z",
    });
  });

  it("says how and when a closed role closed", () => {
    const rejection = email("m2", "2026-10-20T10:00:00.000Z", {
      outcome: "rejected",
    });
    expect(
      applicationNow({
        status: "rejected",
        appliedAt: APPLIED_AT,
        emails: [rejection],
        events: [
          move("e1", "2026-10-20T10:01:00.000Z", "applied", "rejected", {
            source: "email",
            emailId: "m2",
          }),
          applying,
        ],
      }),
    ).toEqual({
      kind: "closed",
      status: "rejected",
      since: "2026-10-20T10:01:00.000Z",
      source: "email",
      email: rejection,
    });

    expect(
      applicationNow({
        status: "no_response",
        appliedAt: APPLIED_AT,
        emails: [],
        events: [
          move("e1", "2026-11-06T06:30:00.000Z", "applied", "no_response", {
            source: "no_reply",
          }),
          applying,
        ],
      }),
    ).toEqual({
      kind: "closed",
      status: "no_response",
      since: "2026-11-06T06:30:00.000Z",
      source: "no_reply",
      email: null,
    });
  });
});

describe("conversationItems", () => {
  it("puts the application, the emails and the moves since applying in order", () => {
    const received = email("m1", "2026-10-07T10:00:00.000Z");
    const invite = email("m2", "2026-10-14T10:00:00.000Z", {
      outcome: "interview",
    });
    const items = conversationItems({
      appliedAt: APPLIED_AT,
      documents: [{ kind: "cv", version: 2 }],
      emails: [invite, received],
      events: [
        move("e2", "2026-10-14T10:01:00.000Z", "applied", "interviewing", {
          source: "email",
          emailId: "m2",
        }),
        applying,
        move("e1", "2026-10-05T09:00:00.000Z", "shortlisted", "ready"),
      ],
    });
    expect(items.map((item) => [item.kind, item.key])).toEqual([
      ["applied", "applied"],
      ["email", "m1"],
      ["email", "m2"],
      ["status", "e2"],
    ]);
    expect(items[3]).toMatchObject({ email: invite });
  });

  it("keeps a move whose email was deleted, without the email", () => {
    const items = conversationItems({
      appliedAt: APPLIED_AT,
      documents: [],
      emails: [],
      events: [
        move("e1", "2026-10-14T10:01:00.000Z", "applied", "interviewing", {
          source: "email",
          emailId: "gone",
        }),
      ],
    });
    expect(items.at(-1)).toMatchObject({ kind: "status", email: null });
  });
});

describe("peopleWhoWrote", () => {
  it("counts the company's emails by who signed them, newest first", () => {
    expect(
      peopleWhoWrote(
        [
          email("m4", "2026-10-17T10:00:00.000Z"),
          email("m3", "2026-10-15T10:00:00.000Z", {
            author: "candidate",
            senderName: "Jordan Sample",
          }),
          email("m2", "2026-10-14T10:00:00.000Z"),
          email("m1", "2026-10-07T10:00:00.000Z", { senderName: null }),
        ],
        "Harbourline",
      ),
    ).toEqual([
      { name: "Lena Hartmann", count: 2 },
      { name: "Harbourline", count: 1 },
    ]);
  });
});
