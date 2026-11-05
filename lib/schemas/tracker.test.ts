import { describe, expect, it } from "vitest";

import { jobEventSchema, statusChangeSchema } from "./tracker";

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

describe("statusChangeSchema", () => {
  it.each(["shortlisted", "skipped", "not_eligible", "applied"] as const)(
    "marks a role %s without a reason",
    (status) => {
      expect(
        statusChangeSchema.safeParse({ jobId: JOB_ID, status, reason: "  " })
          .success,
      ).toBe(true);
    },
  );

  it("keeps the reason, trimmed", () => {
    expect(
      statusChangeSchema.parse({
        jobId: JOB_ID,
        status: "skipped",
        reason: "  Pay too low ",
      }).reason,
    ).toBe("Pay too low");
  });

  it("rejects an unknown status, a bad id and a very long reason", () => {
    expect(
      statusChangeSchema.safeParse({
        jobId: JOB_ID,
        status: "hired",
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({
        jobId: "1",
        status: "applied",
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({
        jobId: JOB_ID,
        status: "skipped",
        reason: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("jobEventSchema", () => {
  it("reads the events the tracker writes", () => {
    expect(
      jobEventSchema.parse({
        type: "status_changed",
        payload: { from: "new", to: "skipped", reason: "Pay too low" },
      }),
    ).toMatchObject({ type: "status_changed" });
    expect(
      jobEventSchema.safeParse({ type: "email_sent", payload: {} }).success,
    ).toBe(false);
  });
});
