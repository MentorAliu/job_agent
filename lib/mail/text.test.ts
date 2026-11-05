import { describe, expect, it } from "vitest";

import { quoteIsInEmail, splitEmail } from "./text";

describe("splitEmail, newest message", () => {
  it("keeps the newest message and drops the thread quoted under it", () => {
    const body = [
      "Hi Jordan,",
      "",
      "Thanks for your time today.   We'll be in touch.",
      "",
      "On Mon, 19 Oct 2026 at 10:00, Jordan Sample <jordan@example.com> wrote:",
      "> Looking forward to it.",
    ].join("\r\n");
    expect(splitEmail(body).newest).toBe(
      "Hi Jordan,\n\nThanks for your time today. We'll be in touch.",
    );
  });

  it("drops an Outlook-style forwarded header and quoted lines", () => {
    const body =
      "Short reply.\n> quoted line\nFrom: Dana <dana@acme.io>\nSent: Monday\nOlder text";
    expect(splitEmail(body).newest).toBe("Short reply.");
  });

  it("keeps a forwarded email's own headers with its message", () => {
    const body = [
      "---------- Forwarded message ---------",
      "From: Dana Reyes <dana@northwind.dev>",
      "Date: Mon, 19 Oct 2026 at 10:00",
      "Subject: Your application",
      "To: Jordan Sample <jordan@example.com>",
      "",
      "Hi Jordan,",
      "We'd love to invite you to an intro call.",
    ].join("\n");
    const { newest, quoted } = splitEmail(body);
    expect(newest).toContain("We'd love to invite you to an intro call.");
    expect(newest).toContain("From: Dana Reyes");
    expect(quoted).toBe("");
  });

  it("still finds the thread under a message pasted with its headers", () => {
    const body = [
      "Subject: Next steps",
      "From: Dana <dana@acme.io>",
      "Sent: Tuesday",
      "",
      "Does Thursday work?",
      "",
      "From: Jordan <jordan@example.com>",
      "Sent: Monday",
      "Thanks for the update.",
    ].join("\n");
    expect(splitEmail(body)).toEqual({
      newest:
        "Subject: Next steps\nFrom: Dana <dana@acme.io>\nSent: Tuesday\n\nDoes Thursday work?",
      quoted:
        "From: Jordan <jordan@example.com>\nSent: Monday\nThanks for the update.",
    });
  });

  it("caps the length", () => {
    expect(splitEmail("a".repeat(50), 10).newest).toBe(`${"a".repeat(10)}…`);
  });
});

describe("splitEmail", () => {
  it("keeps the quoted thread apart, without its > marks", () => {
    const body = [
      "Hi Jordan,",
      "Does Tuesday at 14:00 work?",
      "",
      "On Mon, 19 Oct 2026 at 10:00, Jordan Sample <jordan@example.com> wrote:",
      "> Thanks for the update.",
      ">> Older line",
    ].join("\n");
    expect(splitEmail(body)).toEqual({
      newest: "Hi Jordan,\nDoes Tuesday at 14:00 work?",
      quoted:
        "On Mon, 19 Oct 2026 at 10:00, Jordan Sample <jordan@example.com> wrote:\nThanks for the update.\nOlder line",
    });
  });

  it("has no quoted part when nothing is quoted, and caps each part", () => {
    expect(splitEmail("Just this.")).toEqual({
      newest: "Just this.",
      quoted: "",
    });
    const long = `New\n\nOn Monday, Dana wrote:\n${"b".repeat(30)}`;
    expect(splitEmail(long, 100, 12).quoted).toBe("On Monday, D…");
  });
});

describe("quoteIsInEmail", () => {
  const text = "We’d love to   invite you to an intro call.";

  it("finds the quote ignoring case, spacing and curly quotes", () => {
    expect(quoteIsInEmail("we'd love to invite you", text)).toBe(true);
  });

  it("refuses a quote that isn't there, or is too short to mean anything", () => {
    expect(quoteIsInEmail("We are pleased to offer you", text)).toBe(false);
    expect(quoteIsInEmail("call", text)).toBe(false);
  });
});
