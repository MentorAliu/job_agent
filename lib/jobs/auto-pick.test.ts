import { describe, expect, it } from "vitest";

import type { RoleFocus } from "@/lib/schemas/job";

import {
  AUTO_KITS_PER_DAY,
  AUTO_PICK_MIN_SCORE,
  kitSlots,
  passedReason,
  pickedReason,
  planAutoPick,
  type Candidate,
} from "./auto-pick";
import { STALE_DAYS } from "./posted";
import { addDays } from "./today";

const TODAY = "2026-10-25";
const daysAgo = (days: number) => addDays(TODAY, -days);

const role = (
  id: string,
  score: number,
  { focus = "frontend", postedOn = daysAgo(1) }: Partial<Candidate> = {},
): Candidate => ({ id, score, focus, postedOn });

const ids = (candidates: Candidate[]) => candidates.map((entry) => entry.id);

describe("planAutoPick", () => {
  it("gives kits to the roles over the bar and passes over the rest", () => {
    const plan = planAutoPick(
      [role("a", 76), role("b", 91), role("c", 40), role("d", 83)],
      3,
      "frontend",
      TODAY,
    );
    // Same focus, same day: the best scores first.
    expect(ids(plan.pick)).toEqual(["b", "d", "a"]);
    expect(ids(plan.pass)).toEqual(["c"]);
    expect(plan.wait).toEqual([]);
  });

  it("keeps strong roles over the day's limit for a later search", () => {
    const plan = planAutoPick(
      [role("a", 80), role("b", 95), role("c", 88)],
      1,
      "frontend",
      TODAY,
    );
    expect(ids(plan.pick)).toEqual(["b"]);
    expect(ids(plan.wait)).toEqual(["c", "a"]);
    expect(plan.pass).toEqual([]);
  });

  it("counts a role on the bar as strong, and one below it as passed", () => {
    const plan = planAutoPick(
      [role("on", AUTO_PICK_MIN_SCORE), role("under", AUTO_PICK_MIN_SCORE - 1)],
      0,
      "frontend",
      TODAY,
    );
    expect(plan.pick).toEqual([]);
    expect(ids(plan.wait)).toEqual(["on"]);
    expect(ids(plan.pass)).toEqual(["under"]);
  });

  it("puts frontend roles first, then full-stack, then the rest", () => {
    const focus = (value: RoleFocus) => ({ focus: value });
    const plan = planAutoPick(
      [
        role("backend", 98, focus("backend")),
        role("fullstack", 95, focus("fullstack")),
        role("frontend", 77, focus("frontend")),
        role("other", 90, focus("other")),
      ],
      2,
      "frontend",
      TODAY,
    );
    expect(ids(plan.pick)).toEqual(["frontend", "fullstack"]);
    expect(ids(plan.wait)).toEqual(["backend", "other"]);
  });

  it("puts backend roles first for a backend developer, and none first for any", () => {
    const focus = (value: RoleFocus) => ({ focus: value });
    const roles = [
      role("frontend", 98, focus("frontend")),
      role("fullstack", 95, focus("fullstack")),
      role("backend", 77, focus("backend")),
    ];
    expect(ids(planAutoPick(roles, 3, "backend", TODAY).pick)).toEqual([
      "backend",
      "fullstack",
      "frontend",
    ]);
    expect(ids(planAutoPick(roles, 3, "any", TODAY).pick)).toEqual([
      "frontend",
      "fullstack",
      "backend",
    ]);
  });

  it("puts the newest postings first, with an undated one as a week old", () => {
    const plan = planAutoPick(
      [
        role("old", 95, { postedOn: daysAgo(12) }),
        role("undated", 90, { postedOn: null }),
        role("today", 76, { postedOn: TODAY }),
        role("week", 92, { postedOn: daysAgo(7) }),
      ],
      AUTO_KITS_PER_DAY,
      "frontend",
      TODAY,
    );
    // A week-old posting and an undated one tie, so the score decides.
    expect(ids(plan.pick)).toEqual(["today", "week", "undated"]);
    expect(ids(plan.wait)).toEqual(["old"]);
  });

  it("passes over strong roles posted too long ago", () => {
    const plan = planAutoPick(
      [
        role("stale", 96, { postedOn: daysAgo(STALE_DAYS + 1) }),
        role("edge", 80, { postedOn: daysAgo(STALE_DAYS) }),
        role("undated", 80, { postedOn: null }),
      ],
      3,
      "frontend",
      TODAY,
    );
    // An undated posting counts as a week old, so it goes first.
    expect(ids(plan.pick)).toEqual(["undated", "edge"]);
    expect(ids(plan.pass)).toEqual(["stale"]);
  });
});

describe("kitSlots", () => {
  it("allows the daily limit when nothing has started and money is left", () => {
    expect(kitSlots(0, 15)).toBe(AUTO_KITS_PER_DAY);
  });

  it("subtracts the roles already shortlisted today", () => {
    expect(kitSlots(AUTO_KITS_PER_DAY - 1, 15)).toBe(1);
    expect(kitSlots(AUTO_KITS_PER_DAY + 2, 15)).toBe(0);
  });

  it("starts only as many kits as the budget left can pay for", () => {
    expect(kitSlots(0, 0.25)).toBe(2);
    expect(kitSlots(0, 0.05)).toBe(0);
  });
});

describe("reasons", () => {
  it("say what the app did and why", () => {
    expect(pickedReason(role("a", 88, { postedOn: daysAgo(2) }), TODAY)).toBe(
      "Picked automatically: it scored 88, posted 2 days ago.",
    );
    expect(pickedReason(role("a", 88, { postedOn: null }), TODAY)).toBe(
      "Picked automatically: it scored 88.",
    );
    expect(passedReason(role("b", 52), TODAY)).toBe(
      `Passed over automatically: it scored 52, below ${AUTO_PICK_MIN_SCORE}.`,
    );
    expect(passedReason(role("c", 90, { postedOn: daysAgo(30) }), TODAY)).toBe(
      `Passed over automatically: it was posted 30 days ago, and kits go only to postings up to ${STALE_DAYS} days old. It scored 90.`,
    );
  });
});
