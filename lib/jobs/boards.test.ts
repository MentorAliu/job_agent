import { describe, expect, it } from "vitest";

import type { BoardPosting } from "./ats";
import {
  boardLinks,
  fetchBoardPostings,
  pickBoardLinks,
  watchedBoards,
  type RankedBoardLink,
} from "./boards";
import { STALE_DAYS } from "./posted";
import { addDays } from "./today";

const TODAY = "2026-10-25";
const CLOCK = { timeZone: "Europe/Belgrade", today: TODAY };
const daysAgo = (days: number) => addDays(TODAY, -days);

const role = (
  canonicalUrl: string,
  company = "Acme",
  applyUrl: string | null = null,
) => ({ canonicalUrl, applyUrl, company });

describe("watchedBoards", () => {
  it("takes each company's board once, from the posting or where to apply", () => {
    expect(
      watchedBoards(
        [
          role(
            "https://remotive.com/remote-jobs/software-dev/react-dev-1",
            "Acme",
            "https://boards.greenhouse.io/acme/jobs/1",
          ),
          role("https://job-boards.greenhouse.io/Acme/jobs/2"),
          role(
            "https://jobs.ashbyhq.com/beta/11111111-2222-4333-8444-555555555555",
            "Beta",
          ),
          role("https://weworkremotely.com/remote-jobs/gamma-react", "Gamma"),
        ],
        [],
      ),
    ).toEqual([
      { ats: "greenhouse", name: "acme", eu: false },
      { ats: "ashby", name: "beta", eu: false },
    ]);
  });

  it("leaves out excluded companies, and stops at the limit", () => {
    const roles = [
      role("https://boards.greenhouse.io/acme/jobs/1", "Acme Inc."),
      role("https://boards.greenhouse.io/beta/jobs/2", "Beta"),
      role("https://boards.greenhouse.io/gamma/jobs/3", "Gamma"),
    ];
    expect(watchedBoards(roles, ["acme"]).map((b) => b.name)).toEqual([
      "beta",
      "gamma",
    ]);
    expect(watchedBoards(roles, [], 2).map((b) => b.name)).toEqual([
      "acme",
      "beta",
    ]);
  });
});

const posting = (
  id: string,
  title: string,
  { postedOn = daysAgo(1), remote = true }: Partial<BoardPosting> = {},
): BoardPosting => ({
  id,
  url: `https://boards.greenhouse.io/acme/jobs/${id}`,
  title,
  postedOn,
  remote,
});

describe("boardLinks", () => {
  it("keeps developer roles that can be remote and aren't too old", () => {
    const links = boardLinks(
      [
        posting("1", "Senior Frontend Engineer"),
        posting("2", "Senior Backend Engineer"),
        posting("3", "Junior Frontend Developer"),
        posting("4", "Frontend Engineer", { remote: false }),
        posting("5", "Frontend Engineer", {
          postedOn: daysAgo(STALE_DAYS + 1),
        }),
        posting("6", "Full Stack Engineer", { remote: null, postedOn: null }),
        posting("1", "Senior Frontend Engineer"),
      ],
      TODAY,
      { roleFocus: "frontend", seniority: ["senior"] },
    );
    expect(links).toEqual([
      {
        canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
        dedupeKey: "greenhouse:1",
        postedOn: daysAgo(1),
        rank: 0,
        remote: true,
      },
      {
        canonicalUrl: "https://boards.greenhouse.io/acme/jobs/6",
        dedupeKey: "greenhouse:6",
        postedOn: null,
        rank: 1,
        remote: null,
      },
    ]);
  });
});

describe("pickBoardLinks", () => {
  const link = (
    id: string,
    rank: number,
    remote: boolean | null,
    postedOn: string | null,
  ): RankedBoardLink => ({
    canonicalUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    dedupeKey: `greenhouse:${id}`,
    postedOn,
    rank,
    remote,
  });

  it("reads frontend first, then remote for sure, then the newest", () => {
    const picked = pickBoardLinks(
      [
        link("other", 2, true, daysAgo(0)),
        link("fullstack", 1, true, daysAgo(0)),
        link("frontend-maybe-remote", 0, null, daysAgo(0)),
        link("frontend-old", 0, true, daysAgo(9)),
        link("frontend-new", 0, true, daysAgo(2)),
      ],
      TODAY,
      4,
    );
    expect(picked.map((entry) => entry.dedupeKey)).toEqual([
      "greenhouse:frontend-new",
      "greenhouse:frontend-old",
      "greenhouse:frontend-maybe-remote",
      "greenhouse:fullstack",
    ]);
    expect(picked[0]).toEqual({
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/frontend-new",
      dedupeKey: "greenhouse:frontend-new",
      postedOn: daysAgo(2),
    });
  });
});

describe("fetchBoardPostings", () => {
  it("asks for postings up to STALE_DAYS old, and reads the answer", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: URL | RequestInfo) => {
      urls.push(input.toString());
      return Response.json({
        content: [
          {
            id: "744000012345678",
            name: "Senior Frontend Engineer",
            releasedDate: `${daysAgo(2)}T08:00:00.000Z`,
            location: { remote: true },
          },
        ],
      });
    }) as typeof fetch;
    const postings = await fetchBoardPostings(
      { ats: "smartrecruiters", name: "Acme", eu: false },
      CLOCK,
      { fetch: fetchFn },
    );
    expect(urls).toEqual([
      `https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&releasedAfter=${daysAgo(STALE_DAYS)}T00:00:00.000Z`,
    ]);
    expect(postings).toEqual([
      {
        id: "744000012345678",
        url: "https://jobs.smartrecruiters.com/Acme/744000012345678",
        title: "Senior Frontend Engineer",
        postedOn: daysAgo(2),
        remote: true,
      },
    ]);
  });

  it("returns null when the board can't be read", async () => {
    const acme = { ats: "greenhouse", name: "acme", eu: false } as const;
    const missing = (async () =>
      new Response("Not found", { status: 404 })) as typeof fetch;
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(
      await fetchBoardPostings(acme, CLOCK, { fetch: missing }),
    ).toBeNull();
    expect(
      await fetchBoardPostings(acme, CLOCK, { fetch: failing }),
    ).toBeNull();
  });
});
