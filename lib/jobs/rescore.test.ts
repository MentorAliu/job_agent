import { describe, expect, it } from "vitest";

import {
  pickRolesToRescore,
  profileSearchBlock,
  type RescoreCandidate,
} from "./rescore";

const TODAY = "2026-11-06";

const role = (
  id: string,
  status: RescoreCandidate["status"],
  postedOn: string | null,
  foundOn = postedOn ?? TODAY,
): RescoreCandidate => ({ id, status, postedOn, foundOn });

describe("pickRolesToRescore", () => {
  it("scores waiting roles first, then passed-over ones, the newest first in each", () => {
    expect(
      pickRolesToRescore(
        [
          role("passed-old", "skipped", "2026-10-20"),
          role("waiting-old", "new", "2026-10-25"),
          role("passed-new", "skipped", "2026-11-05"),
          role("waiting-new", "new", "2026-11-04"),
        ],
        TODAY,
      ),
    ).toEqual(["waiting-new", "waiting-old", "passed-new", "passed-old"]);
  });

  it("leaves out postings too old for a kit, and passed-over roles found long ago", () => {
    expect(
      pickRolesToRescore(
        [
          // Posted 22 days ago: auto-pick would pass it over anyway.
          role("stale-waiting", "new", "2026-10-15"),
          role("stale-passed", "skipped", "2026-10-15"),
          // No date, found 22 days ago.
          role("undated-old", "skipped", null, "2026-10-15"),
          // No date, found 21 days ago: still fresh enough.
          role("undated-recent", "skipped", null, "2026-10-16"),
          // No date and waiting: kept, whenever it was found.
          role("undated-waiting", "new", null, "2026-10-01"),
        ],
        TODAY,
      ),
    ).toEqual(["undated-waiting", "undated-recent"]);
  });

  it("keeps to the limit, so a search still scores new postings", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      role(`passed-${index}`, "skipped", "2026-11-01"),
    );
    expect(
      pickRolesToRescore([role("waiting", "new", null), ...many], TODAY),
    ).toHaveLength(40);
    expect(
      pickRolesToRescore([role("waiting", "new", null), ...many], TODAY, 1),
    ).toEqual(["waiting"]);
  });
});

describe("profileSearchBlock", () => {
  const ready = {
    setupDone: true,
    dailyRunEnabled: true,
    changed: true,
    searchesToday: 0,
  };

  it("searches when scoring's input changed", () => {
    expect(profileSearchBlock(ready)).toBeNull();
    expect(profileSearchBlock({ ...ready, searchesToday: 2 })).toBeNull();
  });

  it("doesn't search for a change scoring doesn't read, in setup, or with the daily run off", () => {
    expect(profileSearchBlock({ ...ready, changed: false })).toMatch(
      /Nothing that scoring reads changed/,
    );
    expect(profileSearchBlock({ ...ready, setupDone: false })).toMatch(/setup/);
    expect(profileSearchBlock({ ...ready, dailyRunEnabled: false })).toMatch(
      /daily run is off/,
    );
  });

  it("starts at most 3 searches a day, leaving later changes to the next search", () => {
    expect(profileSearchBlock({ ...ready, searchesToday: 3 })).toMatch(
      /already started 3 searches today/,
    );
  });
});
