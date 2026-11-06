// Each search also reads the remote job boards' own feeds: the lists of
// postings they publish for other sites and apps to use. Plain HTTP, no
// Claude call, so finding the postings costs nothing; each one picked is then
// read like any other posting, from the feed's text instead of its page.
//
// Each board's terms, as checked on 2026-11-05, ask for the same things: say
// the posting came from the board, link to the board's own page for it, and
// send applicants through that page (Himalayas: through the application link
// its feed gives). So a role from a feed keeps the board's link as both its
// posting and where to apply, and the role's page names the board. Jobicy
// asks to be polled at most once an hour, so a feed read in the last hour
// isn't fetched again (see FEED_INTERVAL_MS).
import { z } from "zod";

import type { Preferences } from "@/lib/schemas/profile";

import { postingLink, type PostingLink } from "./canonical-url";
import { isExcludedCompany, normalizeCompany } from "./companies";
import { FEEDS, type FeedId } from "./feed-boards";
import { decodeEntities, htmlToText, MAX_PAGE_CHARS } from "./page-text";
import { countryCode, normalizePlace, placeCovers } from "./places";
import { freshnessAge, isStale, postedDay } from "./posted";
import { fetchPublic, parseJson, type FetchOptions } from "./public-fetch";
import { boardTitleRank } from "./role-focus";
import type { OwnerClock } from "./today";

export { FEED_IDS, FEEDS, feedFor, type FeedId } from "./feed-boards";

/** A feed isn't fetched again within this long of its last read (Jobicy's terms). */
export const FEED_INTERVAL_MS = 60 * 60 * 1000;
/** Postings from the feeds read per search, so the web searches still get their turn. */
export const FEED_POSTINGS_PER_RUN = 15;

// ---------------------------------------------------------------------------
// The requests
// ---------------------------------------------------------------------------

const JSON_TYPE = "application/json";
const RSS_TYPE = "application/rss+xml, application/xml;q=0.9, */*;q=0.8";

/** Himalayas search words for the kind of role the owner wants. */
const FOCUS_QUERY: Record<Preferences["roleFocus"], string> = {
  frontend: "frontend",
  fullstack: "full stack",
  backend: "backend",
  mobile: "mobile",
  any: "software engineer",
};

/**
 * The URLs to ask for one feed. Remote OK and Jobicy list their newest
 * postings; We Work Remotely has one feed per category; Himalayas is
 * searched for the kind of role and the first skill the owner named, open
 * to the first country they work from.
 */
export function feedRequests(
  id: FeedId,
  preferences: Pick<Preferences, "roleFocus" | "stack" | "countries">,
): { url: string; accept: string }[] {
  switch (id) {
    case "remoteok":
      return [{ url: "https://remoteok.com/api", accept: JSON_TYPE }];
    case "weworkremotely":
      return [
        "remote-front-end-programming-jobs",
        "remote-full-stack-programming-jobs",
      ].map((category) => ({
        url: `https://weworkremotely.com/categories/${category}.rss`,
        accept: RSS_TYPE,
      }));
    case "jobicy":
      return [
        {
          url: "https://jobicy.com/api/v2/remote-jobs?count=100&industry=engineering",
          accept: JSON_TYPE,
        },
      ];
    case "himalayas": {
      const country = preferences.countries
        .map(countryCode)
        .find((code) => code !== null);
      const words = [
        FOCUS_QUERY[preferences.roleFocus],
        ...preferences.stack.slice(0, 1),
      ];
      const queries = [...new Set(words.map((word) => word.toLowerCase()))];
      return queries.map((query) => {
        const params = new URLSearchParams({ q: query, sort: "recent" });
        if (country) params.set("country", country);
        return {
          url: `https://himalayas.app/jobs/api/search?${params}`,
          accept: JSON_TYPE,
        };
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

/** One posting as a feed lists it. */
export type FeedPosting = {
  feed: FeedId;
  /** The posting's page on the board, which the board asks apps to link to. */
  url: string;
  /** Where to apply, as the board asks: its own page, or the link it gives. */
  applyUrl: string;
  title: string;
  company: string;
  /** The places the board says the posting is open to. Empty when it doesn't say. */
  places: string[];
  /** The day the board says it went up, "YYYY-MM-DD", or null. */
  postedOn: string | null;
  /** The posting as text, for Claude to read: the board's facts, then the description. */
  text: string;
};

const text = z.string().catch("");
const optionalText = z.string().nullish().catch(null);
const optionalNumber = z.number().nullish().catch(null);
const textList = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.filter((item): item is string => typeof item === "string"),
  );

// Field names and types as the feeds answered on 2026-11-05.
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Text whose UTF-8 was read as Latin-1 once more, as Remote OK's API sends
 * it ("KÃ¤ufer" for "Käufer"), put back. Runs that aren't such bytes stay.
 */
export function repairUtf8(value: string): string {
  return value.replace(/[\u00c2-\u00f4][\u0080-\u00bf]{1,3}/g, (run) => {
    try {
      return UTF8.decode(Uint8Array.from(run, (char) => char.charCodeAt(0)));
    } catch {
      return run;
    }
  });
}
const remoteOkText = text.transform(repairUtf8);

const remoteOkJob = z.object({
  id: z.union([z.string(), z.number()]),
  date: text,
  company: remoteOkText,
  position: remoteOkText,
  tags: textList.transform((tags) => tags.map(repairUtf8)),
  description: remoteOkText,
  location: remoteOkText,
  url: z.string(),
});

const jobicyAnswer = z.object({
  jobs: z.array(z.unknown()),
});
const jobicyJob = z.object({
  url: z.string(),
  jobTitle: text,
  companyName: text,
  jobType: textList,
  jobGeo: text,
  jobLevel: text,
  jobDescription: text,
  pubDate: text,
  salaryMin: optionalNumber,
  salaryMax: optionalNumber,
  salaryCurrency: optionalText,
  salaryPeriod: optionalText,
});

const himalayasAnswer = z.object({
  jobs: z.array(z.unknown()),
});
const himalayasJob = z.object({
  title: text,
  companyName: text,
  employmentType: text,
  minSalary: optionalNumber,
  maxSalary: optionalNumber,
  currency: optionalText,
  salaryPeriod: optionalText,
  seniority: textList,
  locationRestrictions: textList,
  timezoneRestrictions: z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.filter((item): item is number => typeof item === "number"),
    ),
  description: text,
  /** Seconds since 1970. */
  pubDate: optionalNumber,
  applicationLink: optionalText,
  guid: z.string(),
});

/** Each item of a list that parses, leaving out the ones that don't. */
function eachParsed<T>(items: unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A board's link as https, or null for anything that isn't a link on it. */
function boardUrl(value: string, site: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (host !== site && !host.endsWith(`.${site}`)) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/** One line of facts, or nothing when the board gave no value. */
const line = (label: string, value: string | null | undefined) =>
  value && value.trim() ? [`${label}: ${value.trim()}`] : [];

function salaryLine(
  feed: FeedId,
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
): string[] {
  // Without a period, a monthly figure would read as a year's.
  if (min == null || !period) return [];
  const range = max != null && max !== min ? `${min} to ${max}` : `${min}`;
  return [
    `Salary (as ${FEEDS[feed].name} lists it): ${range}${currency ? ` ${currency}` : ""}, ${period}`,
  ];
}

/** A UTC offset in hours, such as 5.5, as "UTC+5:30". */
function utcOffset(hours: number): string {
  const whole = Math.floor(Math.abs(hours));
  const minutes = Math.round((Math.abs(hours) - whole) * 60);
  const sign = hours < 0 ? "-" : "+";
  return `UTC${sign}${whole}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** The board's facts on top, then the description, cut at MAX_PAGE_CHARS. */
function postingText(
  feed: FeedId,
  facts: string[],
  descriptionHtml: string,
): string {
  const description = htmlToText(descriptionHtml);
  return [
    [
      `Listed on ${FEEDS[feed].name}, a job board for remote work.`,
      ...facts,
    ].join("\n"),
    description,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_PAGE_CHARS);
}

/** Places written as one string, such as "Bulgaria,  Poland,  UK" or "US, UK". */
function splitPlaces(value: string): string[] {
  return value
    .split(/[,;/|]|\s+or\s+/i)
    .map((place) => place.trim())
    .filter(Boolean);
}

function readRemoteOk(answer: unknown, clock: OwnerClock): FeedPosting[] {
  // The first item is the API's terms, not a posting.
  if (!Array.isArray(answer)) return [];
  return eachParsed(answer.slice(1), remoteOkJob).flatMap((job) => {
    const url = boardUrl(job.url, FEEDS.remoteok.site);
    const title = decodeEntities(job.position).trim();
    if (!url || !title) return [];
    const postedOn = postedDay(job.date, clock);
    const company = decodeEntities(job.company).trim();
    return [
      {
        feed: "remoteok",
        url,
        applyUrl: url,
        title,
        company,
        places: splitPlaces(job.location),
        postedOn,
        text: postingText(
          "remoteok",
          [
            ...line("Title", title),
            ...line("Company", company),
            ...line("Posted", postedOn),
            ...line("Location", job.location),
            ...line("Tags", job.tags.join(", ")),
          ],
          job.description,
        ),
      },
    ];
  });
}

function readJobicy(answer: unknown, clock: OwnerClock): FeedPosting[] {
  const parsed = jobicyAnswer.safeParse(answer);
  if (!parsed.success) return [];
  return eachParsed(parsed.data.jobs, jobicyJob).flatMap((job) => {
    const url = boardUrl(job.url, FEEDS.jobicy.site);
    const title = decodeEntities(job.jobTitle).trim();
    if (!url || !title) return [];
    const postedOn = postedDay(job.pubDate, clock);
    const company = decodeEntities(job.companyName).trim();
    const places = splitPlaces(decodeEntities(job.jobGeo));
    return [
      {
        feed: "jobicy",
        url,
        applyUrl: url,
        title,
        company,
        places,
        postedOn,
        text: postingText(
          "jobicy",
          [
            ...line("Title", title),
            ...line("Company", company),
            ...line("Posted", postedOn),
            ...line("Open to candidates in", places.join(", ")),
            ...line("Job type", job.jobType.join(", ")),
            ...line("Level", job.jobLevel),
            ...salaryLine(
              "jobicy",
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.salaryPeriod,
            ),
          ],
          job.jobDescription,
        ),
      },
    ];
  });
}

function readHimalayas(answer: unknown, clock: OwnerClock): FeedPosting[] {
  const parsed = himalayasAnswer.safeParse(answer);
  if (!parsed.success) return [];
  return eachParsed(parsed.data.jobs, himalayasJob).flatMap((job) => {
    const url = boardUrl(job.guid, FEEDS.himalayas.site);
    const title = decodeEntities(job.title).trim();
    if (!url || !title) return [];
    const applyUrl =
      (job.applicationLink &&
        boardUrl(job.applicationLink, FEEDS.himalayas.site)) ||
      url;
    const postedOn =
      job.pubDate != null ? postedDay(job.pubDate * 1000, clock) : null;
    const company = decodeEntities(job.companyName).trim();
    return [
      {
        feed: "himalayas",
        url,
        applyUrl,
        title,
        company,
        places: job.locationRestrictions,
        postedOn,
        text: postingText(
          "himalayas",
          [
            ...line("Title", title),
            ...line("Company", company),
            ...line("Posted", postedOn),
            ...line(
              "Open to candidates in",
              job.locationRestrictions.join(", "),
            ),
            ...line(
              "Time zones (UTC offsets, as Himalayas lists them)",
              job.timezoneRestrictions.map(utcOffset).join(", "),
            ),
            ...line("Job type", job.employmentType),
            ...line("Seniority", job.seniority.join(", ")),
            ...salaryLine(
              "himalayas",
              job.minSalary,
              job.maxSalary,
              job.currency,
              job.salaryPeriod,
            ),
          ],
          job.description,
        ),
      },
    ];
  });
}

/** One tag's text in an RSS item, without CDATA, or "" when it's missing. */
function rssTag(item: string, tag: string): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i").exec(item);
  if (!open) return "";
  const start = open.index + open[0].length;
  const end = item.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
  if (end < 0) return "";
  const value = item.slice(start, end).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value);
  return cdata ? cdata[1] : decodeEntities(value);
}

function readWeWorkRemotely(body: string, clock: OwnerClock): FeedPosting[] {
  return body
    .split(/<item>/i)
    .slice(1)
    .flatMap((chunk) => {
      const item = chunk.split(/<\/item>/i)[0] ?? "";
      const url = boardUrl(
        rssTag(item, "link") || rssTag(item, "guid"),
        FEEDS.weworkremotely.site,
      );
      // Titles read "Company: Title".
      const heading = rssTag(item, "title").trim();
      const split = heading.indexOf(": ");
      const company = split > 0 ? heading.slice(0, split).trim() : "";
      const title = split > 0 ? heading.slice(split + 2).trim() : heading;
      if (!url || !title) return [];
      const postedOn = postedDay(rssDate(rssTag(item, "pubDate")), clock);
      const region = rssTag(item, "region");
      return [
        {
          feed: "weworkremotely" as const,
          url,
          applyUrl: url,
          title,
          company,
          places: splitPlaces(region),
          postedOn,
          text: postingText(
            "weworkremotely",
            [
              ...line("Title", title),
              ...line("Company", company),
              ...line("Posted", postedOn),
              ...line("Region", region),
              ...line("Country", rssTag(item, "country")),
              ...line("Category", rssTag(item, "category")),
              ...line("Job type", rssTag(item, "type")),
              ...line("Skills", rssTag(item, "skills")),
            ],
            rssTag(item, "description"),
          ),
        },
      ];
    });
}

/** An RSS date, such as "Sun, 01 Nov 2026 07:31:04 +0000", as milliseconds. */
function rssDate(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** The postings in one feed answer. Anything it can't read gives none. */
export function readFeed(
  id: FeedId,
  body: string,
  clock: OwnerClock,
): FeedPosting[] {
  switch (id) {
    case "remoteok":
      return readRemoteOk(parseJson(body), clock);
    case "jobicy":
      return readJobicy(parseJson(body), clock);
    case "himalayas":
      return readHimalayas(parseJson(body), clock);
    case "weworkremotely":
      return readWeWorkRemotely(body, clock);
  }
}

/**
 * A feed's postings, from all its requests, or null when none of them
 * could be read, so the run searches the board's site instead.
 */
export async function fetchFeed(
  id: FeedId,
  preferences: Pick<Preferences, "roleFocus" | "stack" | "countries">,
  clock: OwnerClock,
  options: FetchOptions = {},
): Promise<FeedPosting[] | null> {
  const answers = await Promise.all(
    feedRequests(id, preferences).map(async ({ url, accept }) => {
      const response = await fetchPublic(url, accept, options);
      return response.ok && response.status >= 200 && response.status < 300
        ? readFeed(id, response.text, clock)
        : null;
    }),
  );
  if (answers.every((answer) => answer === null)) return null;
  return answers.flatMap((answer) => answer ?? []);
}

// ---------------------------------------------------------------------------
// Which postings to read
// ---------------------------------------------------------------------------

/** A posting from a feed, with the day the board says it went up. */
export type FeedLink = PostingLink & { feed: FeedId; postedOn: string | null };

export type RankedFeedLink = FeedLink & {
  /** From boardTitleRank: the kind wanted 0, kinds near it 1, unnamed developer roles 2. */
  rank: number;
};

/**
 * Whether a posting's places may include the owner: false only when every
 * place the board names is one the app knows and none covers the owner's
 * countries. Anything else is left to the eligibility check, which quotes
 * the posting.
 */
export function placesMayFit(
  places: readonly string[],
  ownerCountries: readonly string[],
): boolean {
  const named = places.filter((place) => normalizePlace(place) !== "");
  if (named.length === 0) return true;
  const codes = ownerCountries
    .map(countryCode)
    .filter((code): code is string => code !== null);
  const names = ownerCountries.map(normalizePlace);
  return named.some(
    (place) =>
      names.includes(normalizePlace(place)) ||
      placeCovers(place, codes) !== false,
  );
}

/**
 * The postings worth reading: developer roles the owner wants by their
 * title, open to where the owner lives as far as the board says, not from a
 * company the owner excluded, and not too old for a kit. One per posting,
 * also across boards: the same company and title on two boards is read once.
 */
export function feedLinks(
  postings: Pick<
    FeedPosting,
    "feed" | "url" | "title" | "company" | "places" | "postedOn"
  >[],
  today: string,
  preferences: Pick<
    Preferences,
    "roleFocus" | "seniority" | "countries" | "excludedCompanies"
  >,
): RankedFeedLink[] {
  const links = new Map<string, RankedFeedLink>();
  const roles = new Set<string>();
  for (const posting of postings) {
    const rank = boardTitleRank(posting.title, preferences);
    if (rank === null || isStale(posting.postedOn, today)) continue;
    if (!placesMayFit(posting.places, preferences.countries)) continue;
    if (isExcludedCompany(posting.company, preferences.excludedCompanies)) {
      continue;
    }
    const link = postingLink(posting.url);
    if (!link || links.has(link.dedupeKey)) continue;
    const role = `${normalizeCompany(posting.company)}|${posting.title.toLowerCase().replace(/\s+/g, " ")}`;
    if (posting.company && roles.has(role)) continue;
    roles.add(role);
    links.set(link.dedupeKey, {
      ...link,
      feed: posting.feed,
      postedOn: posting.postedOn,
      rank,
    });
  }
  return [...links.values()];
}

/** The postings feedLinks would read, as the feed listed them, to keep until a run reads them. */
export function worthReading(
  postings: FeedPosting[],
  today: string,
  preferences: Parameters<typeof feedLinks>[2],
): FeedPosting[] {
  const keys = new Set(
    feedLinks(postings, today, preferences).map((link) => link.dedupeKey),
  );
  return postings.filter((posting) => {
    const key = postingLink(posting.url)?.dedupeKey;
    return key !== undefined && keys.has(key);
  });
}

/**
 * The postings to read this search: the kind of role the owner wants first,
 * then the kinds near it, then developer roles that don't say; in each, the
 * newest first.
 */
export function pickFeedLinks(
  links: RankedFeedLink[],
  today: string,
  limit = FEED_POSTINGS_PER_RUN,
): FeedLink[] {
  return [...links]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        freshnessAge(a.postedOn, today) - freshnessAge(b.postedOn, today),
    )
    .slice(0, limit)
    .map(({ canonicalUrl, dedupeKey, feed, postedOn }) => ({
      canonicalUrl,
      dedupeKey,
      feed,
      postedOn,
    }));
}
