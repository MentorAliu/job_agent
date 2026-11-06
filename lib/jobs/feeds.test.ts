import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { samplePreferences } from "@/test/sample-preferences";

import {
  FEED_POSTINGS_PER_RUN,
  feedFor,
  feedLinks,
  feedRequests,
  fetchFeed,
  pickFeedLinks,
  placesMayFit,
  readFeed,
  repairUtf8,
  worthReading,
  type FeedId,
  type FeedPosting,
  type RankedFeedLink,
} from "./feeds";
import { addDays } from "./today";

// The feeds' shapes and field names are as each board answered on
// 2026-11-05; the postings in them are made up.
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../test/fixtures/feeds/${name}`, import.meta.url),
    "utf8",
  );

const TODAY = "2026-11-05";
const CLOCK = { timeZone: "Europe/Belgrade", today: TODAY };
const preferences = {
  ...samplePreferences,
  roleFocus: "frontend" as const,
  seniority: ["senior" as const],
  countries: ["Montenegro"],
  stack: ["TypeScript", "React"],
  excludedCompanies: [],
};

describe("readFeed", () => {
  it("reads Remote OK's API, leaving out its terms and linking to its own page", () => {
    const postings = readFeed("remoteok", fixture("remoteok.json"), CLOCK);
    expect(postings).toHaveLength(4);
    const [tern] = postings;
    expect(tern).toMatchObject({
      feed: "remoteok",
      url: "https://remoteok.com/remote-jobs/remote-senior-frontend-engineer-tern-health-1137601",
      applyUrl:
        "https://remoteok.com/remote-jobs/remote-senior-frontend-engineer-tern-health-1137601",
      title: "Senior Frontend Engineer",
      company: "Tern Health",
      places: ["Europe"],
      postedOn: "2026-11-04",
    });
    expect(tern?.text).toContain(
      "Listed on Remote OK, a job board for remote work.",
    );
    expect(tern?.text).toContain("Location: Europe");
    expect(tern?.text).toContain("- Build our patient app in React");
    expect(tern?.text).toContain("What you'll do");
    expect(tern?.text).not.toMatch(/<\/?[a-z]/);
    // Remote OK sends UTF-8 read as Latin-1 once more.
    expect(tern?.text).toContain(
      "Remote within Europe – we’re fully distributed. Grüße aus Berlin.",
    );
    expect(postings[1]?.places).toEqual(["Remote - US"]);
  });

  it("puts back UTF-8 that was read as Latin-1, and leaves other text alone", () => {
    expect(repairUtf8("KÃ¤ufer prÃ¼fen, 1â\u0080\u00935 years")).toBe(
      "Käufer prüfen, 1–5 years",
    );
    expect(repairUtf8("\u00f0\u009f\u009a\u0080 Build")).toBe("🚀 Build");
    expect(repairUtf8("Käufer, café», naïve")).toBe("Käufer, café», naïve");
  });

  it("reads We Work Remotely's RSS, with the company from the title", () => {
    const postings = readFeed(
      "weworkremotely",
      fixture("weworkremotely-front-end.rss"),
      CLOCK,
    );
    expect(postings.map((posting) => posting.company)).toEqual([
      "Lattice Works",
      "Ridge Pay",
      "Sanctuary Studio",
    ]);
    const [vue] = postings;
    expect(vue).toMatchObject({
      url: "https://weworkremotely.com/remote-jobs/lattice-works-senior-vue-developer",
      applyUrl:
        "https://weworkremotely.com/remote-jobs/lattice-works-senior-vue-developer",
      title: "Senior Vue Developer",
      places: ["Anywhere in the World"],
      postedOn: "2026-11-05",
    });
    expect(vue?.text).toContain("Region: Anywhere in the World");
    expect(vue?.text).toContain("Job type: Full-Time");
    expect(vue?.text).toContain(
      "Lattice Works makes tools for small accounting firms. We’re hiring",
    );
    expect(vue?.text).toContain("- Vue 3 and TypeScript");
    expect(vue?.text).not.toMatch(/&lt;|<p>/);
    expect(postings[1]?.places).toEqual(["USA Only"]);
  });

  it("reads Jobicy's API, keeping its page as where to apply", () => {
    const postings = readFeed("jobicy", fixture("jobicy.json"), CLOCK);
    expect(postings).toHaveLength(3);
    const [react, mesa] = postings;
    expect(react).toMatchObject({
      url: "https://jobicy.com/jobs/159201-senior-react-developer",
      applyUrl: "https://jobicy.com/jobs/159201-senior-react-developer",
      company: "Harbor & Pine",
      places: ["EMEA"],
      postedOn: "2026-11-05",
    });
    expect(react?.text).toContain(
      "Salary (as Jobicy lists it): 60000 to 80000 EUR, yearly",
    );
    expect(react?.text).toContain("Level: Senior");
    expect(react?.text).toContain("Harbor & Pine builds booking tools");
    expect(mesa?.places).toEqual(["Bulgaria", "Poland", "UK", "USA"]);
    // No salary in the feed, so no salary line.
    expect(mesa?.text).not.toContain("Salary");
  });

  it("reads a Himalayas search, applying through the link it gives", () => {
    const postings = readFeed(
      "himalayas",
      fixture("himalayas-search.json"),
      CLOCK,
    );
    const [kite, orchard] = postings;
    expect(kite).toMatchObject({
      url: "https://himalayas.app/companies/kite-analytics/jobs/senior-frontend-engineer",
      applyUrl:
        "https://himalayas.app/companies/kite-analytics/jobs/senior-frontend-engineer?utm_source=api",
      places: ["Montenegro", "Albania", "North Macedonia"],
      postedOn: "2026-11-05",
    });
    expect(kite?.text).toContain(
      "Open to candidates in: Montenegro, Albania, North Macedonia",
    );
    expect(kite?.text).toContain(
      "Time zones (UTC offsets, as Himalayas lists them): UTC+1, UTC+2",
    );
    expect(kite?.text).toContain(
      "Salary (as Himalayas lists it): 4000 to 5500 EUR, monthly",
    );
    expect(orchard?.places).toEqual([]);
    expect(orchard?.text).toContain("UTC+5:30, UTC-3");
    // A salary without its period isn't given at all.
    expect(orchard?.text).not.toContain("Salary");
  });

  it("gives nothing for an answer it can't read", () => {
    expect(readFeed("remoteok", "<html>", CLOCK)).toEqual([]);
    expect(readFeed("jobicy", '{"error":"rate limited"}', CLOCK)).toEqual([]);
    expect(readFeed("weworkremotely", "", CLOCK)).toEqual([]);
    // A link to another site isn't taken as the board's own.
    const forged = JSON.stringify([
      {},
      {
        id: 1,
        date: "2026-11-05T08:00:00+00:00",
        company: "Acme",
        position: "Frontend Engineer",
        tags: [],
        description: "",
        location: "",
        url: "https://example.com/jobs/1",
      },
    ]);
    expect(readFeed("remoteok", forged, CLOCK)).toEqual([]);
  });
});

describe("feedRequests", () => {
  it("searches Himalayas for the kind of role and first skill, open to the owner's country", () => {
    const urls = feedRequests("himalayas", preferences).map(({ url }) => url);
    expect(urls).toEqual([
      "https://himalayas.app/jobs/api/search?q=frontend&sort=recent&country=ME",
      "https://himalayas.app/jobs/api/search?q=typescript&sort=recent&country=ME",
    ]);
  });

  it("reads We Work Remotely's front-end and full-stack categories", () => {
    expect(
      feedRequests("weworkremotely", preferences).map(({ url }) => url),
    ).toEqual([
      "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
      "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    ]);
  });
});

describe("fetchFeed", () => {
  const answer = (status: number, body: string, type = "application/json") =>
    (async () =>
      new Response(body, {
        status,
        headers: { "content-type": type },
      })) as unknown as typeof fetch;

  it("gives the postings, or null when the feed can't be read", async () => {
    const postings = await fetchFeed("jobicy", preferences, CLOCK, {
      fetch: answer(200, fixture("jobicy.json")),
    });
    expect(postings).toHaveLength(3);
    expect(
      await fetchFeed("jobicy", preferences, CLOCK, {
        fetch: answer(429, "Too many requests"),
      }),
    ).toBeNull();
  });

  it("reads RSS sent as application/rss+xml, as We Work Remotely sends it", async () => {
    const postings = await fetchFeed("weworkremotely", preferences, CLOCK, {
      fetch: answer(
        200,
        fixture("weworkremotely-front-end.rss"),
        "application/rss+xml; charset=utf-8",
      ),
    });
    // Both categories answered with the same items here; each is kept once later.
    expect(postings?.length).toBeGreaterThan(0);
  });
});

describe("which feed postings to read", () => {
  const all = (): FeedPosting[] =>
    (
      [
        ["remoteok", "remoteok.json"],
        ["weworkremotely", "weworkremotely-front-end.rss"],
        ["jobicy", "jobicy.json"],
        ["himalayas", "himalayas-search.json"],
      ] as [FeedId, string][]
    ).flatMap(([id, name]) => readFeed(id, fixture(name), CLOCK));

  it("keeps the roles the owner wants, open to where they live, and recent", () => {
    const links = feedLinks(all(), TODAY, preferences);
    expect(links.map((link) => link.canonicalUrl)).toEqual([
      "https://remoteok.com/remote-jobs/remote-senior-frontend-engineer-tern-health-1137601",
      "https://weworkremotely.com/remote-jobs/lattice-works-senior-vue-developer",
      "https://jobicy.com/jobs/159201-senior-react-developer",
      "https://himalayas.app/companies/kite-analytics/jobs/senior-frontend-engineer",
      "https://himalayas.app/companies/orchard-labs/jobs/front-end-developer",
    ]);
    // Left out: US only (twice), Bulgaria to USA without Montenegro, a designer,
    // a head of technology, an administrator, and a role 46 days old.
  });

  it("leaves out companies the owner excluded, and a role listed on two boards", () => {
    const twice = all();
    const copy = twice.find((posting) => posting.company === "Kite Analytics");
    twice.push({
      ...copy!,
      feed: "jobicy",
      url: "https://jobicy.com/jobs/159299-senior-frontend-engineer",
    });
    const links = feedLinks(twice, TODAY, {
      ...preferences,
      excludedCompanies: ["Tern Health"],
    });
    expect(links.map((link) => link.canonicalUrl)).not.toContain(
      "https://remoteok.com/remote-jobs/remote-senior-frontend-engineer-tern-health-1137601",
    );
    expect(
      links.filter((link) => link.canonicalUrl.includes("frontend-engineer")),
    ).toHaveLength(1);
  });

  it("keeps the postings it would read, to read in a later run", () => {
    const kept = worthReading(all(), TODAY, preferences);
    expect(kept.map((posting) => posting.company)).toEqual([
      "Tern Health",
      "Lattice Works",
      "Harbor & Pine",
      "Kite Analytics",
      "Orchard Labs",
    ]);
  });

  it("reads the kind of role wanted first, then the newest, up to the limit", () => {
    const link = (
      n: number,
      rank: number,
      postedOn: string | null,
    ): RankedFeedLink => ({
      canonicalUrl: `https://remoteok.com/remote-jobs/role-${n}`,
      dedupeKey: `url:remoteok.com/remote-jobs/role-${n}`,
      feed: "remoteok",
      postedOn,
      rank,
    });
    const picked = pickFeedLinks(
      [
        link(1, 1, TODAY),
        link(2, 0, addDays(TODAY, -5)),
        link(3, 0, TODAY),
        link(4, 0, null),
      ],
      TODAY,
    );
    expect(picked.map((entry) => entry.canonicalUrl.slice(-1))).toEqual([
      "3",
      "2",
      "4",
      "1",
    ]);
    expect(picked[0]).not.toHaveProperty("rank");
    const many = Array.from({ length: 40 }, (_, n) => link(n, 0, TODAY));
    expect(pickFeedLinks(many, TODAY)).toHaveLength(FEED_POSTINGS_PER_RUN);
  });

  it("rules a posting out by its places only when every place is known and none covers the owner", () => {
    const montenegro = ["Montenegro"];
    expect(placesMayFit([], montenegro)).toBe(true);
    expect(placesMayFit(["Anywhere in the World"], montenegro)).toBe(true);
    expect(placesMayFit(["EMEA"], montenegro)).toBe(true);
    expect(placesMayFit(["Montenegro", "Albania"], montenegro)).toBe(true);
    expect(placesMayFit(["Palo Alto"], montenegro)).toBe(true);
    expect(placesMayFit(["USA Only"], montenegro)).toBe(false);
    expect(placesMayFit(["North America Only"], montenegro)).toBe(false);
    expect(placesMayFit(["Remote - US"], montenegro)).toBe(false);
    expect(placesMayFit(["UK", "USA"], montenegro)).toBe(false);
    expect(placesMayFit(["UK", "Palo Alto"], montenegro)).toBe(true);
  });
});

describe("feedFor", () => {
  it("names the board a link is on, when the app reads its feed", () => {
    expect(feedFor("https://remoteOK.com/remote-jobs/x-1")).toBe("remoteok");
    expect(feedFor("https://himalayas.app/companies/a/jobs/b")).toBe(
      "himalayas",
    );
    expect(feedFor("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(feedFor("not a link")).toBeNull();
  });
});
