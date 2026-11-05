import { describe, expect, it } from "vitest";

import {
  boardApiUrl,
  boardKey,
  parseAtsBoard,
  parseAtsLink,
  postingApiPostedOn,
  postingApiUrl,
  readBoard,
  type AtsBoard,
} from "./ats";

// Belgrade has summer time, so the dates cover days that turn over at 22:00
// or 23:00 UTC.
const CLOCK = { timeZone: "Europe/Belgrade", today: "2026-10-25" };
const LEVER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEVER_ID_2 = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ASHBY_ID = "11111111-2222-4333-8444-555555555555";
const ASHBY_ID_2 = "21111111-2222-4333-8444-555555555555";

const board = (ats: AtsBoard["ats"], name = "acme", eu = false): AtsBoard => ({
  ats,
  name,
  eu,
});

describe("parseAtsLink", () => {
  it("finds the board and posting behind each system's links", () => {
    expect(
      parseAtsLink(
        new URL("https://job-boards.eu.greenhouse.io/acme/jobs/123"),
      ),
    ).toEqual({ board: board("greenhouse", "acme", true), id: "123" });
    expect(
      parseAtsLink(new URL(`https://jobs.eu.lever.co/acme/${LEVER_ID}/apply`)),
    ).toEqual({ board: board("lever", "acme", true), id: LEVER_ID });
    expect(
      parseAtsLink(new URL("https://acme.workable.com/j/ABC123DEF0")),
    ).toEqual({ board: board("workable"), id: "ABC123DEF0" });
    expect(
      parseAtsLink(new URL("https://acme.recruitee.com/o/Senior-Engineer")),
    ).toEqual({ board: board("recruitee"), id: "senior-engineer" });
  });

  it("finds no board behind other links", () => {
    for (const url of [
      "https://remotive.com/remote-jobs/software-dev/react-dev-123",
      "https://boards.greenhouse.io/acme",
      "https://jobs.lever.co/acme/not-a-posting",
      "https://www.workable.com/j/ABC123DEF0",
      "https://acme.recruitee.com/",
      "not a link",
    ]) {
      expect(parseAtsBoard(url), url).toBeNull();
    }
  });
});

describe("a board's API", () => {
  it("keys each board once, whatever the case of its name", () => {
    expect(boardKey(board("greenhouse", "Acme"))).toBe(
      boardKey(board("greenhouse", "acme")),
    );
    expect(boardKey(board("greenhouse", "acme", true))).not.toBe(
      boardKey(board("greenhouse", "acme")),
    );
  });

  it("lists each system's open postings", () => {
    expect(boardApiUrl(board("greenhouse", "acme", true))).toBe(
      "https://boards-api.eu.greenhouse.io/v1/boards/acme/jobs",
    );
    expect(boardApiUrl(board("lever"))).toBe(
      "https://api.lever.co/v0/postings/acme?mode=json",
    );
    expect(boardApiUrl(board("smartrecruiters", "Acme"), "2026-10-04")).toBe(
      "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&releasedAfter=2026-10-04T00:00:00.000Z",
    );
    expect(boardApiUrl(board("ashby"))).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/acme",
    );
  });

  it("asks about one posting only where the system can", () => {
    expect(
      postingApiUrl({ board: board("lever", "acme", true), id: LEVER_ID }),
    ).toBe(`https://api.eu.lever.co/v0/postings/acme/${LEVER_ID}`);
    expect(postingApiUrl({ board: board("ashby"), id: ASHBY_ID })).toBeNull();
  });
});

describe("readBoard", () => {
  it("reads Greenhouse, keeping postings on the board's own pages", () => {
    const answer = {
      jobs: [
        {
          id: 4012345,
          title: "Senior Frontend Engineer",
          absolute_url:
            "https://job-boards.greenhouse.io/acme/jobs/4012345?gh_jid=4012345",
          first_published: "2026-10-20T10:00:00-04:00",
          updated_at: "2026-10-24T10:00:00-04:00",
          location: { name: "Remote - Europe" },
        },
        {
          id: 4012346,
          title: "Senior Backend Engineer",
          absolute_url: "https://acme.com/careers?gh_jid=4012346",
          first_published: "2026-10-21T10:00:00-04:00",
          location: { name: "Berlin" },
        },
        { id: "x1", title: "Broken" },
      ],
    };
    expect(readBoard(board("greenhouse"), answer, CLOCK)).toEqual([
      {
        id: "4012345",
        url: "https://job-boards.greenhouse.io/acme/jobs/4012345?gh_jid=4012345",
        title: "Senior Frontend Engineer",
        postedOn: "2026-10-20",
        remote: true,
      },
      {
        id: "4012346",
        url: "https://job-boards.greenhouse.io/acme/jobs/4012346",
        title: "Senior Backend Engineer",
        postedOn: "2026-10-21",
        remote: null,
      },
    ]);
  });

  it("reads Lever, from its workplace type or else its location", () => {
    const answer = [
      {
        id: LEVER_ID,
        text: "Senior Frontend Engineer",
        hostedUrl: `https://jobs.lever.co/acme/${LEVER_ID}`,
        createdAt: Date.UTC(2026, 9, 20, 9),
        workplaceType: "hybrid",
        categories: { location: "Remote" },
      },
      {
        id: LEVER_ID_2,
        text: "Full Stack Engineer",
        hostedUrl: "http://localhost/jobs/1",
        createdAt: Date.UTC(2026, 9, 22, 9),
        workplaceType: "unspecified",
        categories: { location: "Remote, EU" },
      },
    ];
    expect(readBoard(board("lever"), answer, CLOCK)).toEqual([
      {
        id: LEVER_ID,
        url: `https://jobs.lever.co/acme/${LEVER_ID}`,
        title: "Senior Frontend Engineer",
        postedOn: "2026-10-20",
        remote: false,
      },
      {
        id: LEVER_ID_2,
        // A link that isn't a public website is replaced by the board's own.
        url: `https://jobs.lever.co/acme/${LEVER_ID_2}`,
        title: "Full Stack Engineer",
        postedOn: "2026-10-22",
        remote: true,
      },
    ]);
  });

  it("reads SmartRecruiters", () => {
    const answer = {
      totalFound: 2,
      content: [
        {
          id: "744000012345678",
          name: "Senior Frontend Engineer",
          releasedDate: "2026-10-20T08:00:00.000Z",
          location: { city: "Berlin", remote: true, hybrid: false },
        },
        {
          id: "744000012345679",
          name: "Senior React Developer",
          releasedDate: "2026-10-21T08:00:00.000Z",
          location: { city: "Berlin", remote: false, hybrid: true },
        },
      ],
    };
    expect(readBoard(board("smartrecruiters", "Acme"), answer, CLOCK)).toEqual([
      {
        id: "744000012345678",
        url: "https://jobs.smartrecruiters.com/Acme/744000012345678",
        title: "Senior Frontend Engineer",
        postedOn: "2026-10-20",
        remote: true,
      },
      {
        id: "744000012345679",
        url: "https://jobs.smartrecruiters.com/Acme/744000012345679",
        title: "Senior React Developer",
        postedOn: "2026-10-21",
        remote: false,
      },
    ]);
  });

  it("reads Ashby", () => {
    const answer = {
      apiVersion: "1",
      jobs: [
        {
          id: ASHBY_ID,
          title: "Senior Frontend Engineer",
          publishedAt: "2026-10-20T08:00:00.000+00:00",
          isListed: true,
          isRemote: true,
          workplaceType: "Remote",
          jobUrl: `https://jobs.ashbyhq.com/acme/${ASHBY_ID}`,
        },
        {
          id: ASHBY_ID_2,
          title: "Product Engineer",
          publishedAt: "2026-10-21T08:00:00.000+00:00",
          isRemote: false,
          workplaceType: "OnSite",
          jobUrl: `https://jobs.ashbyhq.com/acme/${ASHBY_ID_2}`,
        },
      ],
    };
    expect(
      readBoard(board("ashby"), answer, CLOCK)?.map(
        ({ id, postedOn, remote }) => ({ id, postedOn, remote }),
      ),
    ).toEqual([
      { id: ASHBY_ID, postedOn: "2026-10-20", remote: true },
      { id: ASHBY_ID_2, postedOn: "2026-10-21", remote: false },
    ]);
  });

  it("reads Workable", () => {
    const answer = {
      name: "Acme",
      jobs: [
        {
          shortcode: "abc123def0",
          title: "Senior Frontend Engineer",
          url: "https://apply.workable.com/j/ABC123DEF0",
          published_on: "2026-10-20",
          telecommuting: true,
        },
        {
          shortcode: "zz",
          title: "Not a Workable code",
          published_on: "2026-10-20",
        },
      ],
    };
    expect(readBoard(board("workable"), answer, CLOCK)).toEqual([
      {
        id: "ABC123DEF0",
        url: "https://apply.workable.com/acme/j/ABC123DEF0",
        title: "Senior Frontend Engineer",
        postedOn: "2026-10-20",
        remote: true,
      },
    ]);
  });

  it("reads Recruitee's published offers only", () => {
    const answer = {
      offers: [
        {
          slug: "senior-frontend-engineer",
          title: "Senior Frontend Engineer",
          status: "published",
          published_at: "2026-10-15 09:31:36 UTC",
          remote: true,
          hybrid: false,
          on_site: false,
          careers_url: "https://careers.acme.com/o/senior-frontend-engineer",
        },
        { slug: "draft-role", title: "Draft role", status: "draft" },
        {
          slug: "office-role",
          title: "Frontend Engineer",
          status: "published",
          published_at: "2026-10-16 09:31:36 UTC",
          remote: false,
          hybrid: false,
          on_site: true,
        },
      ],
    };
    expect(readBoard(board("recruitee"), answer, CLOCK)).toEqual([
      {
        id: "senior-frontend-engineer",
        url: "https://careers.acme.com/o/senior-frontend-engineer",
        title: "Senior Frontend Engineer",
        postedOn: "2026-10-15",
        remote: true,
      },
      {
        id: "office-role",
        url: "https://acme.recruitee.com/o/office-role",
        title: "Frontend Engineer",
        postedOn: "2026-10-16",
        remote: false,
      },
    ]);
  });

  it("returns null for an answer that isn't the board's list", () => {
    expect(
      readBoard(board("greenhouse"), { message: "Not found" }, CLOCK),
    ).toBeNull();
    expect(readBoard(board("lever"), { ok: false }, CLOCK)).toBeNull();
    expect(readBoard(board("ashby"), null, CLOCK)).toBeNull();
    // An empty board is a list, with nothing on it.
    expect(readBoard(board("ashby"), { jobs: [] }, CLOCK)).toEqual([]);
  });
});

describe("postingApiPostedOn", () => {
  it("reads the day from one posting's own answer", () => {
    expect(
      postingApiPostedOn(
        { board: board("greenhouse"), id: "123" },
        { id: 123, first_published: "2026-10-20T10:00:00-04:00" },
        CLOCK,
      ),
    ).toBe("2026-10-20");
    expect(
      postingApiPostedOn(
        { board: board("lever"), id: LEVER_ID },
        { id: LEVER_ID, createdAt: Date.UTC(2026, 9, 19, 9) },
        CLOCK,
      ),
    ).toBe("2026-10-19");
    expect(
      postingApiPostedOn(
        { board: board("smartrecruiters"), id: "744000012345678" },
        { releasedDate: "2026-10-18T08:00:00.000Z" },
        CLOCK,
      ),
    ).toBe("2026-10-18");
    expect(
      postingApiPostedOn({ board: board("greenhouse"), id: "1" }, null, CLOCK),
    ).toBeNull();
  });
});
