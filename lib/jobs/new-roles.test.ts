import { describe, expect, it } from "vitest";

import {
  FIRST_VISIT_MS,
  isNewRole,
  markSeen,
  newSince,
  parseRolesSeen,
  serializeRolesSeen,
  unseenSince,
  VISIT_GAP_MS,
} from "./new-roles";

const at = (iso: string) => new Date(iso);
const MINUTE = 60 * 1000;

describe("the roles-seen cookie", () => {
  it("reads back what it wrote", () => {
    const seen = {
      seenAt: at("2026-10-19T08:00:00Z"),
      newSince: at("2026-10-18T21:00:00Z"),
    };
    expect(parseRolesSeen(serializeRolesSeen(seen))).toEqual(seen);
  });

  it("ignores a missing, malformed or backwards value", () => {
    expect(parseRolesSeen(undefined)).toBeNull();
    expect(parseRolesSeen("")).toBeNull();
    expect(parseRolesSeen("yesterday")).toBeNull();
    expect(parseRolesSeen("1.2.3")).toBeNull();
    expect(parseRolesSeen("-5.3")).toBeNull();
    // newSince after seenAt can't come from markSeen.
    expect(parseRolesSeen("1000.2000")).toBeNull();
  });
});

describe("which roles are new", () => {
  const evening = at("2026-10-18T21:00:00Z");
  const morning = at("2026-10-19T08:00:00Z");

  it("counts the past day as new before the first visit", () => {
    expect(newSince(null, morning)).toEqual(
      new Date(morning.getTime() - FIRST_VISIT_MS),
    );
    expect(unseenSince(null, morning)).toEqual(newSince(null, morning));
  });

  it("starts a visit from where the last one ended", () => {
    const seen = markSeen(markSeen(null, evening), evening);
    expect(newSince(seen, morning)).toEqual(evening);

    const visit = markSeen(seen, morning);
    expect(visit).toEqual({ seenAt: morning, newSince: evening });
  });

  it("keeps the same cut-off while the owner comes back within the gap", () => {
    let seen = markSeen(markSeen(null, evening), morning);
    for (const minutes of [5, 20, 45]) {
      const now = new Date(morning.getTime() + minutes * MINUTE);
      expect(newSince(seen, now)).toEqual(evening);
      seen = markSeen(seen, now);
    }
  });

  it("starts a new visit after the gap", () => {
    const seen = markSeen(markSeen(null, evening), morning);
    const later = new Date(morning.getTime() + VISIT_GAP_MS + MINUTE);
    expect(newSince(seen, later)).toEqual(morning);
  });

  it("clears the top bar's count as soon as the page is open", () => {
    const seen = markSeen(markSeen(null, evening), morning);
    expect(unseenSince(seen, morning)).toEqual(morning);
  });

  it("marks roles found after the cut-off", () => {
    expect(isNewRole("2026-10-19T07:05:00Z", evening)).toBe(true);
    expect(isNewRole("2026-10-18T20:59:00Z", evening)).toBe(false);
    expect(isNewRole("2026-10-19T07:05:00Z", null)).toBe(false);
  });
});
