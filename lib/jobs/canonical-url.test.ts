import { describe, expect, it } from "vitest";

import {
  contentKey,
  looksLikeOpenWebPosting,
  looksLikePosting,
  postingLink,
} from "./canonical-url";

describe("postingLink", () => {
  it("keys ATS postings on their own id, whatever the link", () => {
    expect(
      postingLink("https://boards.greenhouse.io/acme/jobs/4012345?utm_source=x")
        ?.dedupeKey,
    ).toBe("greenhouse:4012345");
    expect(
      postingLink("https://job-boards.eu.greenhouse.io/acme/jobs/4012345")
        ?.dedupeKey,
    ).toBe("greenhouse:4012345");
    expect(
      postingLink("https://acme.com/careers/job?gh_jid=4012345")?.dedupeKey,
    ).toBe("greenhouse:4012345");

    const lever =
      "https://jobs.lever.co/acme/3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
    expect(postingLink(`${lever}/apply?lever-source=board`)).toEqual({
      canonicalUrl: lever,
      dedupeKey: "lever:3f2b1c9e-4d5a-4e6f-8a7b-9c0d1e2f3a4b",
    });
    expect(
      postingLink(
        "https://jobs.ashbyhq.com/acme/9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d/application",
      )?.dedupeKey,
    ).toBe("ashby:9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d");
    expect(
      postingLink("https://apply.workable.com/acme/j/A1B2C3D4E5/")?.dedupeKey,
    ).toBe("workable:A1B2C3D4E5");
    expect(
      postingLink(
        "https://jobs.smartrecruiters.com/Acme/744000012345678-senior-engineer",
      )?.dedupeKey,
    ).toBe("smartrecruiters:744000012345678");
  });

  it("keys other links on host, path and real query parameters", () => {
    expect(
      postingLink(
        "https://www.weworkremotely.com/remote-jobs/acme-senior-react-developer/?ref=feed#apply",
      ),
    ).toEqual({
      canonicalUrl:
        "https://weworkremotely.com/remote-jobs/acme-senior-react-developer",
      dedupeKey:
        "url:weworkremotely.com/remote-jobs/acme-senior-react-developer",
    });
    expect(postingLink("https://careers.acme.com/job?id=42")?.dedupeKey).toBe(
      "url:careers.acme.com/job?id=42",
    );
  });

  it("rejects links that aren't http(s)", () => {
    expect(postingLink("mailto:jobs@acme.com")).toBeNull();
    expect(postingLink("not a url")).toBeNull();
  });
});

describe("looksLikePosting", () => {
  it("accepts single postings", () => {
    expect(
      looksLikePosting("https://boards.greenhouse.io/acme/jobs/4012345"),
    ).toBe(true);
    expect(
      looksLikePosting(
        "https://remotive.com/remote-jobs/software-dev/senior-react-engineer-12345",
      ),
    ).toBe(true);
  });

  it("rejects board front pages and lists of jobs", () => {
    expect(looksLikePosting("https://boards.greenhouse.io/acme")).toBe(false);
    expect(looksLikePosting("https://jobs.lever.co/acme")).toBe(false);
    expect(looksLikePosting("https://weworkremotely.com/")).toBe(false);
    expect(looksLikePosting("https://remotive.com/remote-jobs")).toBe(false);
    expect(looksLikePosting("https://himalayas.app/companies/acme/jobs")).toBe(
      false,
    );
  });

  it("knows which job board pages are postings, from a live run's skips", () => {
    const postings = [
      "https://remoteok.com/remote-jobs/106131-remote-react-engineer-acme",
      "https://remoteok.com/remote-jobs/remote-react-engineer-acme-1093290",
      "https://remotive.com/remote-jobs/software-dev/senior-angular-developer-2069981",
      "https://remotive.com/remote/jobs/software-development/senior-typescript-engineer-5291422",
      "https://himalayas.app/companies/acme/jobs/senior-react-developer",
      "https://weworkremotely.com/remote-jobs/acme-senior-react-developer",
      "https://landing.jobs/at/acme/senior-frontend-engineer",
    ];
    for (const url of postings) expect(looksLikePosting(url), url).toBe(true);

    const notPostings = [
      // Remote OK's pages for hiring people with a skill.
      "https://remoteok.com/hire-remotely/angular+react-native",
      "https://remoteok.com/hire-remotely/next-js",
      "https://remoteok.com/hire/nestjs",
      // Remotive's pages without a posting id.
      "https://remotive.com/remote-jobs/o-react-node-developer",
      // Himalayas' search pages.
      "https://himalayas.app/jobs/angularjs",
      "https://himalayas.app/jobs/remote-senior-frontend-developer-(typescript-nextjs)",
      "https://weworkremotely.com/categories/remote-full-stack-programming-jobs",
      "https://landing.jobs/at/acme",
    ];
    for (const url of notPostings)
      expect(looksLikePosting(url), url).toBe(false);
  });
});

describe("looksLikeOpenWebPosting", () => {
  it("accepts single postings on employers' own sites and the systems they hire with", () => {
    const postings = [
      "https://www.acme.com/careers/senior-react-engineer",
      "https://careers.acme.com/senior-react-engineer",
      "https://acme.io/en/open-positions/frontend-lead-1234",
      "https://acme.jobs.personio.de/job/1234567?language=en",
      "https://acme.teamtailor.com/jobs/4012345-senior-frontend-engineer",
      "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Remote/Senior-Engineer_R123",
      "https://acme.bamboohr.com/careers/45",
      "https://acme.com/company?gh_jid=4012345",
      "https://acme.de/karriere/senior-frontend-entwickler",
    ];
    for (const url of postings)
      expect(looksLikeOpenWebPosting(url), url).toBe(true);
  });

  it("leaves out job sites that forbid scraping, lists of jobs and articles", () => {
    const notPostings = [
      // Off limits, at any subdomain.
      "https://www.linkedin.com/jobs/view/senior-react-engineer-at-acme-4012345",
      "https://uk.indeed.com/viewjob?jk=abc123",
      "https://www.glassdoor.co.uk/job-listing/senior-react-engineer-acme-JV_123.htm",
      "https://wellfound.com/jobs/4012345-senior-react-engineer",
      // A careers page, a front page and a list of openings.
      "https://acme.com/careers",
      "https://careers.acme.com/",
      "https://acme.com/about/jobs",
      // Pages that aren't about a job.
      "https://acme.com/blog/how-we-ship-react",
      "https://news.example.com/2026/10/tech-layoffs",
      // Board pages that aren't postings keep their own rules.
      "https://remoteok.com/hire-remotely/react",
      "not a link",
    ];
    for (const url of notPostings)
      expect(looksLikeOpenWebPosting(url), url).toBe(false);
  });
});

describe("contentKey", () => {
  it("matches the same posting on two sites", () => {
    expect(
      contentKey({
        company: "Acme, Inc.",
        title: "Senior React Engineer",
        allowed: ["Europe"],
      }),
    ).toBe(
      contentKey({
        company: "ACME",
        title: "Senior React  Engineer",
        allowed: ["europe"],
      }),
    );
    expect(
      contentKey({
        company: "Acme",
        title: "Senior React Engineer",
        allowed: ["Europe"],
      }),
    ).not.toBe(
      contentKey({
        company: "Acme",
        title: "Senior React Engineer",
        allowed: ["United States"],
      }),
    );
  });
});
