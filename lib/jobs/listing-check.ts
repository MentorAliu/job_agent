// Whether a saved posting is still open. The daily check asks the employer's
// applicant tracking system through its public API where it has one, and
// otherwise reads the posting's page. These are plain HTTP requests, with no
// Claude call, so the check costs nothing. It only calls a listing closed on
// a clear sign; anything it can't read (a block, a timeout, an odd answer)
// leaves the role as it is. Along the way it notes the day the posting went
// up, where the system or the page says.
import {
  ATS_NAMES,
  boardApiUrl,
  parseAtsLink,
  postingApiPostedOn,
  postingApiUrl,
  readBoard,
  type AtsLink,
} from "./ats";
import { isListPath, postingLink } from "./canonical-url";
import { postedDay } from "./posted";
import {
  fetchPublic,
  isPublicUrl,
  parseJson,
  type Fetched,
  type FetchOptions,
} from "./public-fetch";
import type { OwnerClock } from "./today";

export type ListingVerdict = "open" | "closed" | "unknown";

export type ListingCheck = {
  verdict: ListingVerdict;
  /** The employer's own tracking system answered, not a page. */
  fromAts: boolean;
  /** Why it reads as closed, for the role's timeline. Empty otherwise. */
  reason: string;
  /** The day the posting went up, "YYYY-MM-DD", when the system or page says. */
  postedOn?: string;
};

export type Listing = {
  canonicalUrl: string;
  applyUrl: string | null;
  /** The page as it read when the role was found. */
  description: string | null;
};

export type CheckOptions = FetchOptions & {
  /** The owner's day and time zone, for reading posting dates. */
  clock: OwnerClock;
};

const UNKNOWN: ListingCheck = {
  verdict: "unknown",
  fromAts: false,
  reason: "",
};

/** How to ask about one link. */
type Probe =
  /** The ATS answers for the one posting: missing means closed. */
  | { kind: "posting"; ats: string; url: string; link: AtsLink }
  /** The ATS lists the company's open postings: not listed means closed. */
  | {
      kind: "board";
      ats: string;
      url: string;
      link: AtsLink;
      listed: (board: unknown, text: string) => boolean | null;
    }
  /** Anything else: the page itself. */
  | { kind: "page"; url: string };

/**
 * How to ask whether the posting at `url` is open, or null for a link that
 * mustn't be fetched: not http(s), or not a public host.
 */
export function probeFor(url: string): Probe | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isPublicUrl(parsed)) return null;
  return atsProbe(parsed) ?? { kind: "page", url: parsed.toString() };
}

function atsProbe(url: URL): Probe | null {
  const link = parseAtsLink(url);
  if (!link) return null;
  const ats = ATS_NAMES[link.board.ats];
  const posting = postingApiUrl(link);
  if (posting) return { kind: "posting", ats, url: posting, link };
  return {
    kind: "board",
    ats,
    url: boardApiUrl(link.board),
    link,
    listed: listedOn(link),
  };
}

/** Whether a board's answer lists the posting, or null when it can't tell. */
function listedOn({
  board,
  id,
}: AtsLink): (board: unknown, text: string) => boolean | null {
  switch (board.ats) {
    case "recruitee":
      return (answer) => {
        if (!hasArray(answer, "offers")) return null;
        return answer.offers.some(
          (offer) =>
            typeof offer === "object" &&
            offer !== null &&
            "slug" in offer &&
            String(offer.slug).toLowerCase() === id,
        );
      };
    case "workable":
      return (answer, text) =>
        hasArray(answer, "jobs")
          ? text.toUpperCase().includes(id.toUpperCase())
          : null;
    default:
      return (answer, text) =>
        hasArray(answer, "jobs")
          ? text.toLowerCase().includes(id.toLowerCase())
          : null;
  }
}

function hasArray<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)[key])
  );
}

/** A check, with the day the posting went up when it's known. */
function withPostedOn(
  check: ListingCheck,
  postedOn: string | null | undefined,
): ListingCheck {
  return postedOn ? { ...check, postedOn } : check;
}

/**
 * The day a page's own job data says the posting went up: the schema.org
 * `datePosted` that job sites add for search engines.
 */
export function pagePostedOn(html: string, clock: OwnerClock): string | null {
  const match =
    /"datePosted"\s*:\s*"([^"]{4,40})"/.exec(html) ??
    /itemprop=["']datePosted["'][^>]*?\scontent=["']([^"']{4,40})["']/i.exec(
      html,
    );
  return match ? postedDay(match[1], clock) : null;
}

const gone = (status: number) => status === 404 || status === 410;
const success = (status: number) => status >= 200 && status < 300;

/** Asks about one link. */
export async function checkLink(
  url: string,
  description: string | null,
  options: CheckOptions,
): Promise<ListingCheck> {
  const probe = probeFor(url);
  if (!probe) return UNKNOWN;

  if (probe.kind === "posting") {
    const response = await fetchPublic(probe.url, "application/json", options);
    if (!response.ok) return UNKNOWN;
    if (gone(response.status)) {
      return {
        verdict: "closed",
        fromAts: true,
        reason: `${probe.ats} says the employer closed the posting.`,
      };
    }
    return success(response.status)
      ? withPostedOn(
          { verdict: "open", fromAts: true, reason: "" },
          postingApiPostedOn(
            probe.link,
            parseJson(response.text),
            options.clock,
          ),
        )
      : UNKNOWN;
  }

  if (probe.kind === "board") {
    const response = await fetchPublic(probe.url, "application/json", options);
    if (!response.ok || !success(response.status)) return UNKNOWN;
    const answer = parseJson(response.text);
    const listed = probe.listed(answer, response.text);
    if (listed === null) return UNKNOWN;
    const posting = readBoard(probe.link.board, answer, options.clock)?.find(
      (entry) => entry.id.toLowerCase() === probe.link.id.toLowerCase(),
    );
    return listed
      ? withPostedOn(
          { verdict: "open", fromAts: true, reason: "" },
          posting?.postedOn,
        )
      : {
          verdict: "closed",
          fromAts: true,
          reason: `The employer's ${probe.ats} job board no longer lists the posting.`,
        };
  }

  const page = await fetchPublic(probe.url, "text/html", options);
  if (!page.ok) return UNKNOWN;
  // A board's apply link often leads on to the employer's own posting.
  const landed = page.redirected ? probeFor(page.url) : null;
  if (landed && landed.kind !== "page" && success(page.status)) {
    return checkLink(page.url, description, options);
  }
  const check = readPage(new URL(probe.url), page, description);
  return check.verdict === "open"
    ? withPostedOn(check, pagePostedOn(page.text, options.clock))
    : check;
}

/** What a posting's own page says about it. */
export function readPage(
  original: URL,
  page: Extract<Fetched, { ok: true }>,
  description: string | null,
): ListingCheck {
  const final = new URL(page.url);
  const site = final.hostname.replace(/^www\./, "");
  if (gone(page.status)) {
    return {
      verdict: "closed",
      fromAts: false,
      reason: `The posting's page on ${site} is gone.`,
    };
  }
  if (!success(page.status)) return UNKNOWN;
  if (
    page.redirected &&
    isListPath(final) &&
    (sameSite(original, final) || final.searchParams.get("error") === "true")
  ) {
    return {
      verdict: "closed",
      fromAts: false,
      reason: `The posting's link now opens ${site}'s list of jobs.`,
    };
  }
  const phrase = closedPhrase(visibleText(page.text));
  // Words the page already had when the role was found are part of it,
  // such as "we hire until the position is filled".
  if (phrase && !normalize(description ?? "").includes(phrase)) {
    return {
      verdict: "closed",
      fromAts: false,
      reason: `The posting's page says “${phrase}”.`,
    };
  }
  return { verdict: "open", fromAts: false, reason: "" };
}

/** Whether two hosts belong to one site, such as www.acme.com and jobs.acme.com. */
function sameSite(a: URL, b: URL): boolean {
  const site = (url: URL) =>
    url.hostname.toLowerCase().split(".").slice(-2).join(".");
  return site(a) === site(b);
}

const NOUNS =
  "(?:job|position|role|vacancy|posting|listing|opening|offer|job post|job posting|job listing|job ad|job offer)";

/** What a page says when its posting is closed. */
const CLOSED_PHRASES = [
  /no longer accepting applications/,
  new RegExp(
    `this ${NOUNS} (?:is no longer (?:available|open|active|online)|(?:is|was|has been) (?:closed|filled|removed|taken down)|has (?:been )?expired)`,
  ),
  /the (?:job|position|role|posting) you(?:'re| are) looking for (?:is no longer|has been|was|no longer|could not|can't|cannot)[a-z' ]*/,
];

export function closedPhrase(text: string): string | null {
  for (const pattern of CLOSED_PHRASES) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  rsquo: "'",
  lsquo: "'",
  "#39": "'",
  "#x27": "'",
  "#8217": "'",
};

/** A page's text as a reader sees it: no scripts, styles or tags. */
export function visibleText(html: string): string {
  return normalize(
    html
      .replace(
        /<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&([a-z]+|#\d+|#x[\da-f]+);/gi, (entity, name: string) =>
        name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : entity,
      ),
  );
}

/** Lower case, straight apostrophes, single spaces. */
function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Checks a role's links: the posting and, when it's somewhere else, where
 * to apply. The employer's tracking system has the last word, since a job
 * board can keep a posting up after the employer closes it, or drop one the
 * employer still has open. Without it, any page that reads as closed counts.
 */
export async function checkListing(
  listing: Listing,
  options: CheckOptions,
): Promise<ListingCheck> {
  const links = [listing.canonicalUrl];
  const posting = postingLink(listing.canonicalUrl)?.dedupeKey;
  if (listing.applyUrl) {
    const apply = postingLink(listing.applyUrl);
    if (apply && apply.dedupeKey !== posting) links.push(listing.applyUrl);
  }
  const checks = await Promise.all(
    links.map((link) => checkLink(link, listing.description, options)),
  );
  return combineChecks(checks);
}

export function combineChecks(checks: ListingCheck[]): ListingCheck {
  const ats = checks.filter((check) => check.fromAts);
  const decided = ats.some((check) => check.verdict !== "unknown")
    ? ats
    : checks;
  const verdict =
    decided.find((check) => check.verdict === "closed") ??
    decided.find((check) => check.verdict === "open") ??
    UNKNOWN;
  // The employer's own system knows best when the posting went up.
  const dated =
    ats.find((check) => check.postedOn) ??
    checks.find((check) => check.postedOn);
  return withPostedOn(verdict, dated?.postedOn);
}
