import { describe, expect, it } from "vitest";

import {
  checkLink,
  checkListing,
  closedPhrase,
  combineChecks,
  pagePostedOn,
  probeFor,
  visibleText,
  type ListingCheck,
} from "./listing-check";
import { addDays, ownerClock } from "./today";

// The checks date postings against today's real date, in a time zone with
// summer time.
const clock = ownerClock("Europe/Belgrade");

type Reply = {
  status: number;
  body?: string | object;
  type?: string;
  location?: string;
};

/** A stand-in for fetch that answers from a table and records each URL. */
function fakeFetch(replies: Record<string, Reply | "error">) {
  const urls: string[] = [];
  const fetchFn = (async (input: URL | RequestInfo) => {
    const url = input.toString();
    urls.push(url);
    const reply = replies[url];
    if (!reply || reply === "error") throw new TypeError("fetch failed");
    const body =
      typeof reply.body === "object" ? JSON.stringify(reply.body) : reply.body;
    const headers = new Headers({
      "content-type":
        reply.type ??
        (typeof reply.body === "object" ? "application/json" : "text/html"),
    });
    if (reply.location) headers.set("location", reply.location);
    return new Response(body ?? null, { status: reply.status, headers });
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

const LEVER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ASHBY_ID = "11111111-2222-4333-8444-555555555555";

describe("asking the employer's tracking system", () => {
  it("builds each system's public API link from the posting's link", () => {
    expect(
      probeFor("https://boards.greenhouse.io/acme/jobs/123"),
    ).toMatchObject({
      kind: "posting",
      url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
    });
    expect(
      probeFor("https://job-boards.eu.greenhouse.io/acme/jobs/123?gh_src=x"),
    ).toMatchObject({
      url: "https://boards-api.eu.greenhouse.io/v1/boards/acme/jobs/123",
    });
    expect(
      probeFor(
        "https://boards.greenhouse.io/embed/job_app?for=acme&token=4567",
      ),
    ).toMatchObject({
      url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4567",
    });
    expect(
      probeFor(`https://jobs.lever.co/acme/${LEVER_ID}/apply`),
    ).toMatchObject({
      url: `https://api.lever.co/v0/postings/acme/${LEVER_ID}`,
    });
    expect(
      probeFor(
        "https://jobs.smartrecruiters.com/Acme/744000012345678-senior-engineer",
      ),
    ).toMatchObject({
      url: "https://api.smartrecruiters.com/v1/companies/Acme/postings/744000012345678",
    });
    expect(probeFor(`https://jobs.ashbyhq.com/acme/${ASHBY_ID}`)).toMatchObject(
      {
        kind: "board",
        url: "https://api.ashbyhq.com/posting-api/job-board/acme",
      },
    );
    expect(
      probeFor("https://apply.workable.com/acme/j/ABC123DEF0/"),
    ).toMatchObject({
      kind: "board",
      url: "https://apply.workable.com/api/v1/widget/accounts/acme",
    });
    expect(
      probeFor("https://acme.recruitee.com/o/senior-engineer"),
    ).toMatchObject({
      kind: "board",
      url: "https://acme.recruitee.com/api/offers/",
    });
  });

  it("reads anything else as a page, and never fetches a local address", () => {
    expect(probeFor("https://remotive.com/remote-jobs/dev/react-1")).toEqual({
      kind: "page",
      url: "https://remotive.com/remote-jobs/dev/react-1",
    });
    expect(probeFor("http://localhost/jobs/1")).toBeNull();
    expect(probeFor("http://169.254.169.254/latest")).toBeNull();
    expect(probeFor("https://intranet.corp/jobs/1")).toBeNull();
    expect(probeFor("https://acme.com:8443/jobs/1")).toBeNull();
    expect(probeFor("mailto:jobs@acme.com")).toBeNull();
    // Sites whose terms forbid apps to read their pages, for roles the
    // owner added from them.
    expect(
      probeFor("https://www.linkedin.com/jobs/view/senior-react-4012345"),
    ).toBeNull();
    expect(probeFor("https://de.indeed.com/viewjob?jk=abc123")).toBeNull();
    // Only the systems' own domains, and a bad escape doesn't throw.
    expect(probeFor("https://notgreenhouse.io/acme/jobs/1")).toMatchObject({
      kind: "page",
    });
    expect(probeFor("https://jobs.lever.co/acme/%E0%A4%A")).toMatchObject({
      kind: "page",
    });
  });

  it("calls a posting closed when the system no longer has it", async () => {
    const { fetch } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123": {
        status: 404,
        body: { status: 404, error: "Job not found" },
      },
      [`https://api.lever.co/v0/postings/acme/${LEVER_ID}`]: {
        status: 200,
        body: { id: LEVER_ID },
      },
    });
    expect(
      await checkLink("https://boards.greenhouse.io/acme/jobs/123", null, {
        clock,
        fetch,
      }),
    ).toEqual({
      verdict: "closed",
      fromAts: true,
      reason: "Greenhouse says the employer closed the posting.",
    });
    expect(
      await checkLink(`https://jobs.lever.co/acme/${LEVER_ID}`, null, {
        clock,
        fetch,
      }),
    ).toEqual({ verdict: "open", fromAts: true, reason: "" });
  });

  it("leaves a posting alone when the system can't be asked", async () => {
    const { fetch } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1": { status: 503 },
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/2": "error",
    });
    for (const id of [1, 2]) {
      expect(
        await checkLink(`https://boards.greenhouse.io/acme/jobs/${id}`, null, {
          clock,
          fetch,
        }),
      ).toMatchObject({ verdict: "unknown" });
    }
  });

  it("looks the posting up on the company's board, fetched once", async () => {
    const board = "https://api.ashbyhq.com/posting-api/job-board/acme";
    const { fetch, urls } = fakeFetch({
      [board]: {
        status: 200,
        body: {
          jobs: [
            {
              id: ASHBY_ID,
              jobUrl: `https://jobs.ashbyhq.com/acme/${ASHBY_ID}`,
            },
          ],
        },
      },
    });
    const cache = new Map();
    const other = "99999999-2222-4333-8444-555555555555";
    expect(
      await checkLink(`https://jobs.ashbyhq.com/acme/${ASHBY_ID}`, null, {
        clock,
        fetch,
        cache,
      }),
    ).toMatchObject({ verdict: "open" });
    expect(
      await checkLink(`https://jobs.ashbyhq.com/acme/${other}`, null, {
        clock,
        fetch,
        cache,
      }),
    ).toEqual({
      verdict: "closed",
      fromAts: true,
      reason: "The employer's Ashby job board no longer lists the posting.",
    });
    expect(urls).toEqual([board]);
  });

  it("trusts a board only when it reads as one", async () => {
    const { fetch } = fakeFetch({
      "https://apply.workable.com/api/v1/widget/accounts/acme": {
        status: 200,
        body: { message: "Not here" },
      },
      "https://acme.recruitee.com/api/offers/": {
        status: 200,
        body: { offers: [{ slug: "senior-engineer-2" }] },
      },
    });
    expect(
      await checkLink("https://apply.workable.com/acme/j/ABC123DEF0", null, {
        clock,
        fetch,
      }),
    ).toMatchObject({ verdict: "unknown" });
    // A slug is matched whole, not as part of another.
    expect(
      await checkLink("https://acme.recruitee.com/o/senior-engineer", null, {
        clock,
        fetch,
      }),
    ).toMatchObject({ verdict: "closed" });
  });
});

describe("reading a posting's page", () => {
  const url = "https://remotive.com/remote-jobs/software-dev/react-dev-123";

  it("calls a page that's gone closed, and a blocked one unknown", async () => {
    const { fetch } = fakeFetch({ [url]: { status: 404, body: "Not found" } });
    expect(await checkLink(url, null, { clock, fetch })).toEqual({
      verdict: "closed",
      fromAts: false,
      reason: "The posting's page on remotive.com is gone.",
    });
    const blocked = fakeFetch({ [url]: { status: 403, body: "Blocked" } });
    expect(
      await checkLink(url, null, { clock, fetch: blocked.fetch }),
    ).toMatchObject({
      verdict: "unknown",
    });
  });

  it("calls a link that now opens the site's list of jobs closed", async () => {
    const { fetch } = fakeFetch({
      [url]: { status: 301, location: "/remote-jobs" },
      "https://remotive.com/remote-jobs": {
        status: 200,
        body: "<h1>Jobs</h1>",
      },
    });
    expect(await checkLink(url, null, { clock, fetch })).toEqual({
      verdict: "closed",
      fromAts: false,
      reason: "The posting's link now opens remotive.com's list of jobs.",
    });
  });

  it("doesn't follow a redirect to a local address", async () => {
    const { fetch, urls } = fakeFetch({
      [url]: { status: 302, location: "http://127.0.0.1/admin" },
    });
    expect(await checkLink(url, null, { clock, fetch })).toMatchObject({
      verdict: "unknown",
    });
    expect(urls).toEqual([url]);
  });

  it("finds what a closed page says, and only in its visible text", async () => {
    const closed = `<html><head><title>React dev</title></head><body>
      <div class="banner">This job is no longer accepting&nbsp;applications.</div>
      <h1>React developer</h1></body></html>`;
    const open = `<html><body><h1>React developer</h1>
      <script>const t = { closed: "This position has been filled" };</script>
      <p>Apply below.</p></body></html>`;
    const pages = fakeFetch({
      [url]: { status: 200, body: closed },
      [`${url}-open`]: { status: 200, body: open },
    });
    expect(await checkLink(url, null, { clock, fetch: pages.fetch })).toEqual({
      verdict: "closed",
      fromAts: false,
      reason: "The posting's page says “no longer accepting applications”.",
    });
    expect(
      await checkLink(`${url}-open`, null, { clock, fetch: pages.fetch }),
    ).toEqual({ verdict: "open", fromAts: false, reason: "" });
  });

  it("ignores words the page already had when the role was found", async () => {
    const page = `<p>We review applications until this position is filled.</p>`;
    const { fetch } = fakeFetch({ [url]: { status: 200, body: page } });
    expect(
      await checkLink(
        url,
        "We review applications until this position is filled.",
        { clock, fetch },
      ),
    ).toMatchObject({ verdict: "open" });
    expect(await checkLink(url, null, { clock, fetch })).toMatchObject({
      verdict: "closed",
    });
  });

  it("follows a board's apply link on to the employer's own system", async () => {
    const apply = "https://remoteok.com/l/106131";
    const posting = `https://jobs.lever.co/acme/${LEVER_ID}`;
    const { fetch } = fakeFetch({
      [apply]: { status: 302, location: posting },
      [posting]: { status: 200, body: "<h1>React developer</h1>" },
      [`https://api.lever.co/v0/postings/acme/${LEVER_ID}`]: {
        status: 404,
        body: { ok: false },
      },
    });
    expect(await checkLink(apply, null, { clock, fetch })).toEqual({
      verdict: "closed",
      fromAts: true,
      reason: "Lever says the employer closed the posting.",
    });
  });
});

describe("a role's verdict", () => {
  const closed = (fromAts: boolean): ListingCheck => ({
    verdict: "closed",
    fromAts,
    reason: fromAts ? "ats" : "page",
  });
  const open = (fromAts: boolean): ListingCheck => ({
    verdict: "open",
    fromAts,
    reason: "",
  });
  const unknown: ListingCheck = {
    verdict: "unknown",
    fromAts: false,
    reason: "",
  };

  it("lets the employer's system decide over a job board", () => {
    // The board still shows it, but the employer closed it.
    expect(combineChecks([open(false), closed(true)])).toEqual(closed(true));
    // The board dropped it, but the employer still has it open.
    expect(combineChecks([closed(false), open(true)])).toEqual(open(true));
  });

  it("counts a closed page when the employer's system can't say", () => {
    expect(combineChecks([closed(false), unknown])).toEqual(closed(false));
    expect(combineChecks([open(false), unknown])).toEqual(open(false));
    expect(combineChecks([unknown, unknown])).toEqual(unknown);
  });

  it("checks the board's posting and the employer's apply link", async () => {
    const board = "https://himalayas.app/companies/acme/jobs/react-developer";
    const { fetch, urls } = fakeFetch({
      [board]: { status: 200, body: "<h1>React developer</h1>" },
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123": {
        status: 404,
      },
    });
    expect(
      await checkListing(
        {
          canonicalUrl: board,
          applyUrl: "https://boards.greenhouse.io/acme/jobs/123",
          description: null,
        },
        { clock, fetch },
      ),
    ).toMatchObject({ verdict: "closed", fromAts: true });
    expect(urls).toHaveLength(2);
  });

  it("checks a posting's own apply page only once", async () => {
    const posting = `https://jobs.lever.co/acme/${LEVER_ID}`;
    const { fetch, urls } = fakeFetch({
      [`https://api.lever.co/v0/postings/acme/${LEVER_ID}`]: {
        status: 200,
        body: {},
      },
    });
    await checkListing(
      {
        canonicalUrl: posting,
        applyUrl: `${posting}/apply`,
        description: null,
      },
      { clock, fetch },
    );
    expect(urls).toHaveLength(1);
  });
});

describe("the day a posting went up", () => {
  const recent = addDays(clock.today, -3);
  const older = addDays(clock.today, -5);

  it("reads it from the employer's system", async () => {
    const { fetch } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123": {
        status: 200,
        body: { id: 123, first_published: `${recent}T10:00:00-04:00` },
      },
      "https://api.ashbyhq.com/posting-api/job-board/acme": {
        status: 200,
        body: {
          jobs: [
            {
              id: ASHBY_ID,
              title: "Senior Frontend Engineer",
              publishedAt: `${older}T08:00:00.000+00:00`,
            },
          ],
        },
      },
    });
    expect(
      await checkLink("https://boards.greenhouse.io/acme/jobs/123", null, {
        clock,
        fetch,
      }),
    ).toEqual({ verdict: "open", fromAts: true, reason: "", postedOn: recent });
    expect(
      await checkLink(`https://jobs.ashbyhq.com/acme/${ASHBY_ID}`, null, {
        clock,
        fetch,
      }),
    ).toMatchObject({ verdict: "open", postedOn: older });
  });

  it("reads it from the job data a page gives search engines", async () => {
    const url = "https://remotive.com/remote-jobs/software-dev/react-dev-123";
    const page = `<html><head><script type="application/ld+json">
      {"@type": "JobPosting", "title": "React developer", "datePosted": "${recent}"}
      </script></head><body><h1>React developer</h1></body></html>`;
    const { fetch } = fakeFetch({ [url]: { status: 200, body: page } });
    expect(await checkLink(url, null, { clock, fetch })).toEqual({
      verdict: "open",
      fromAts: false,
      reason: "",
      postedOn: recent,
    });
    expect(
      pagePostedOn(`<meta itemprop="datePosted" content="${older}">`, clock),
    ).toBe(older);
    expect(pagePostedOn("<p>Posted 3 days ago</p>", clock)).toBeNull();
  });

  it("prefers the employer's system's day to a job board's", () => {
    const board: ListingCheck = {
      verdict: "open",
      fromAts: false,
      reason: "",
      postedOn: recent,
    };
    const ats: ListingCheck = {
      verdict: "open",
      fromAts: true,
      reason: "",
      postedOn: older,
    };
    expect(combineChecks([board, ats])).toMatchObject({ postedOn: older });
    expect(
      combineChecks([board, { ...ats, postedOn: undefined }]),
    ).toMatchObject({ verdict: "open", fromAts: true, postedOn: recent });
  });
});

describe("closed wording", () => {
  it("matches what closed postings say", () => {
    for (const text of [
      "sorry, this job has expired.",
      "this position is no longer available",
      "this job post is closed and the position is probably filled",
      "this vacancy has been filled",
      "the job you're looking for is no longer available",
    ]) {
      expect(closedPhrase(text), text).not.toBeNull();
    }
  });

  it("doesn't match an open posting's usual words", () => {
    for (const text of [
      "applications close on 30 november",
      "we hire until the position is filled",
      "this role is remote",
      "this job is open to candidates in europe",
    ]) {
      expect(closedPhrase(text), text).toBeNull();
    }
  });

  it("reads a page's text without its scripts, styles and tags", () => {
    expect(
      visibleText(
        "<style>.x{}</style><p>It&#39;s   <b>open</b></p><script>closed</script>",
      ),
    ).toBe(" it's open ");
  });
});
