// Step 3 of the pipeline: one key per posting, so a posting found again, at
// another link or in a later run, isn't stored twice.
import { OFF_LIMITS_JOB_SITES } from "@/lib/schemas/settings";

import { normalizeCompany } from "./companies";

/** Query parameters that only track where a click came from. */
const TRACKING_PARAMS =
  /^(utm_.*|ref|referrer|source|src|gh_src|lever-source|lever-origin|ashby_jid_source|fbclid|gclid|mc_cid|mc_eid|_hs.*)$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PostingLink = {
  /** The link without tracking parameters, fragment or trailing slash. */
  canonicalUrl: string;
  /** The same posting always gets the same key, at any of its links. */
  dedupeKey: string;
};

/**
 * Cleans a posting link and works out its dedupe key. Links on the big
 * applicant tracking systems key on the posting's own id; anything else keys
 * on host and path. Returns null for a link that isn't http(s).
 */
export function postingLink(url: string): PostingLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment !== "");
  const params = new URLSearchParams();
  for (const [key, value] of [...parsed.searchParams].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!TRACKING_PARAMS.test(key)) params.append(key, value);
  }

  const ats = atsKey(host, segments, params);
  // Apply pages share the posting's key and link to the posting itself.
  const path =
    ats && /^(apply|application)$/i.test(segments.at(-1) ?? "")
      ? segments.slice(0, -1)
      : segments;
  const query = params.size > 0 ? `?${params}` : "";
  const canonicalUrl = `https://${host}${path.length > 0 ? `/${path.join("/")}` : ""}${query}`;

  return {
    canonicalUrl,
    dedupeKey: ats ?? `url:${host}/${path.join("/").toLowerCase()}${query}`,
  };
}

function atsKey(
  host: string,
  segments: string[],
  params: URLSearchParams,
): string | null {
  // Greenhouse: boards.greenhouse.io/acme/jobs/123, an embed with ?token=123,
  // or a career site with ?gh_jid=123.
  const ghJid = params.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return `greenhouse:${ghJid}`;
  if (host.endsWith("greenhouse.io")) {
    const index = segments.indexOf("jobs");
    const id = index >= 0 ? segments[index + 1] : params.get("token");
    if (id && /^\d+$/.test(id)) return `greenhouse:${id}`;
  }
  // Lever: jobs.lever.co/acme/<uuid>
  if (host.endsWith("lever.co") && segments[1] && UUID.test(segments[1])) {
    return `lever:${segments[1].toLowerCase()}`;
  }
  // Ashby: jobs.ashbyhq.com/acme/<uuid>
  if (host.endsWith("ashbyhq.com") && segments[1] && UUID.test(segments[1])) {
    return `ashby:${segments[1].toLowerCase()}`;
  }
  // Workable: apply.workable.com/acme/j/ABC123
  if (host.endsWith("workable.com")) {
    const index = segments.indexOf("j");
    const code = index >= 0 ? segments[index + 1] : undefined;
    if (code && /^[0-9A-F]{6,}$/i.test(code))
      return `workable:${code.toUpperCase()}`;
  }
  // SmartRecruiters: jobs.smartrecruiters.com/Acme/7444…-senior-engineer
  if (host.endsWith("smartrecruiters.com")) {
    const id = /^(\d{6,})/.exec(segments[1] ?? "")?.[1];
    if (id) return `smartrecruiters:${id}`;
  }
  return null;
}

/** The last path segments of pages that list many jobs rather than one. */
const LIST_PAGES =
  /^(jobs|careers|remote-jobs|search|categories|category|tags?|companies|company|locations?|departments?|teams?|openings|positions|all|latest)$/i;

/** Whether a link opens a site's front page or a list of jobs, not one posting. */
export function isListPath(url: URL): boolean {
  const last = url.pathname
    .split("/")
    .filter((segment) => segment !== "")
    .at(-1);
  return last === undefined || LIST_PAGES.test(last);
}

/**
 * The shape of one posting's path on job boards that also have pages that
 * aren't postings, such as Remote OK's pages for hiring people with a skill
 * (/hire-remotely/react). Seen in a live run.
 */
const BOARD_POSTING_PATHS: [host: RegExp, path: RegExp][] = [
  // remoteok.com/remote-jobs/106131-remote-react-engineer-acme
  [/(^|\.)remoteok\.com$/, /^remote-jobs\/(\d+-[^/]+|[^/]+-\d+)$/],
  // remotive.com/remote-jobs/software-dev/senior-react-engineer-2069981
  [/(^|\.)remotive\.com$/, /^remote(-jobs|\/jobs)\/[^/]+\/[^/]+-\d+$/],
  // himalayas.app/companies/acme/jobs/senior-react-engineer
  [/(^|\.)himalayas\.app$/, /^companies\/[^/]+\/jobs\/[^/]+$/],
  // weworkremotely.com/remote-jobs/acme-senior-react-engineer
  [/(^|\.)weworkremotely\.com$/, /^remote-jobs\/[^/]+$/],
  // landing.jobs/at/acme/senior-react-engineer
  [/(^|\.)landing\.jobs$/, /^at\/[^/]+\/[^/]+$/],
];

/**
 * Whether a link looks like one posting rather than a job board's front page
 * or a list of jobs. Links that don't are left out before anything is
 * fetched; the extract step still checks each page it reads.
 */
export function looksLikePosting(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment !== "");
  const params = new URLSearchParams(parsed.search);
  if (atsKey(host.replace(/^www\./, ""), segments, params)) return true;
  if (
    /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com)$/.test(
      host,
    )
  ) {
    // An ATS link without a posting id is a company's list of openings.
    return false;
  }
  const board = BOARD_POSTING_PATHS.find(([pattern]) => pattern.test(host));
  if (board && !board[1].test(segments.join("/"))) return false;
  const last = segments.at(-1);
  return segments.length >= 2 && !!last && !LIST_PAGES.test(last);
}

/** Words that say a link is about a job, in English and a few European languages. */
const JOB_WORDS =
  /job|career|position|opening|vacanc|vacature|hiring|recruit|apply|posting|opportunit|role|join|karriere|stellen|emploi|empleo|lavor|kariera|praca|werken/i;

/**
 * Whether a link from the open-web search may be one posting on an
 * employer's own site: not on a job site that's off limits, shaped like one
 * posting, and about a job by its host or path. Articles and blog posts
 * mostly fail the last test; the extract step still checks each page it
 * reads.
 */
export function looksLikeOpenWebPosting(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    OFF_LIMITS_JOB_SITES.some(
      (site) => host === site || host.endsWith(`.${site}`),
    )
  ) {
    return false;
  }
  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment !== "");
  const params = new URLSearchParams(parsed.search);
  // A careers page that embeds an ATS posting, such as ?gh_jid=123.
  if (atsKey(host.replace(/^www\./, ""), segments, params)) return true;
  if (JOB_WORDS.test(host)) {
    // careers.acme.com/senior-react-engineer
    return segments.length === 1 ? !isListPath(parsed) : looksLikePosting(url);
  }
  return looksLikePosting(url) && JOB_WORDS.test(parsed.pathname);
}

/**
 * A second key for the same posting at a different link, such as a job board
 * reposting an ATS listing: company, title and allowed places, normalized.
 */
export function contentKey(posting: {
  company: string;
  title: string;
  allowed: string[];
}): string {
  const clean = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const places = posting.allowed.map(clean).filter(Boolean).sort().join(",");
  return `${normalizeCompany(posting.company)}|${clean(posting.title)}|${places}`;
}
