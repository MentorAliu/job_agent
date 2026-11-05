// The applicant tracking systems that host company job boards, and their
// public APIs: no key, no Claude call. The daily listing check asks them
// whether a posting is still open, and each search reads the boards of
// companies that already posted a role the owner can take. Shapes checked
// against each system's live API on 25 October 2026.
import { postedDay } from "./posted";
import { isPublicUrl } from "./public-fetch";
import type { OwnerClock } from "./today";

export const ATS_NAMES = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  smartrecruiters: "SmartRecruiters",
  ashby: "Ashby",
  workable: "Workable",
  recruitee: "Recruitee",
} as const;

export type Ats = keyof typeof ATS_NAMES;

/** A company's job board on one of the systems. */
export type AtsBoard = {
  ats: Ats;
  /** The company's name on the system: a board, site, account or subdomain. */
  name: string;
  /** Greenhouse and Lever keep European companies on their own hosts. */
  eu: boolean;
};

/** One posting on a board, by the system's own id for it. */
export type AtsLink = { board: AtsBoard; id: string };

/** One open posting, as a board's API lists it. */
export type BoardPosting = {
  /** The system's id for the posting. */
  id: string;
  /** The posting's own page, in the form a search finds it. */
  url: string;
  title: string;
  /** The day it was posted, "YYYY-MM-DD", or null when the board doesn't say. */
  postedOn: string | null;
  /** True when the board says remote, false when it says hybrid or on-site. */
  remote: boolean | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path segment as text, or as it is when it isn't valid percent-encoding. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const path = (...parts: string[]) => parts.map(encodeURIComponent).join("/");

/** The board and posting a link points to, or null when it isn't one. */
export function parseAtsLink(url: URL): AtsLink | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map(decodeSegment);
  const link = (ats: Ats, name: string, id: string, eu = false): AtsLink => ({
    board: { ats, name, eu },
    id,
  });

  // boards.greenhouse.io/acme/jobs/123, job-boards.eu.greenhouse.io/acme/jobs/123
  // or an embed with ?for=acme&token=123.
  if (on("greenhouse.io")) {
    const [board, id] =
      segments[0] === "embed"
        ? [url.searchParams.get("for"), url.searchParams.get("token")]
        : segments[1] === "jobs"
          ? [segments[0], segments[2]]
          : [null, null];
    if (!board || !id || !/^\d+$/.test(id)) return null;
    return link("greenhouse", board, id, host.includes(".eu."));
  }
  // jobs.lever.co/acme/<uuid>
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [site, id] = segments;
    if (!site || !id || !UUID.test(id)) return null;
    return link("lever", site, id, host === "jobs.eu.lever.co");
  }
  // jobs.smartrecruiters.com/Acme/744000012345678-senior-engineer
  if (
    host === "jobs.smartrecruiters.com" ||
    host === "careers.smartrecruiters.com"
  ) {
    const company = segments[0];
    const id = /^(\d{6,})/.exec(segments[1] ?? "")?.[1];
    if (!company || !id) return null;
    return link("smartrecruiters", company, id);
  }
  // jobs.ashbyhq.com/acme/<uuid>
  if (host === "jobs.ashbyhq.com") {
    const [org, id] = segments;
    if (!org || !id || !UUID.test(id)) return null;
    return link("ashby", org, id);
  }
  // apply.workable.com/acme/j/ABC123 or acme.workable.com/j/ABC123
  if (on("workable.com")) {
    const subdomain = host.slice(0, -".workable.com".length);
    const [account, code] =
      host === "apply.workable.com"
        ? segments[1] === "j"
          ? [segments[0], segments[2]]
          : [null, null]
        : segments[0] === "j" && !["", "www", "jobs"].includes(subdomain)
          ? [subdomain, segments[1]]
          : [null, null];
    if (!account || !code || !/^[0-9A-F]{6,}$/i.test(code)) return null;
    return link("workable", account, code);
  }
  // acme.recruitee.com/o/senior-engineer
  if (host.endsWith(".recruitee.com") && segments[0] === "o" && segments[1]) {
    return link(
      "recruitee",
      host.slice(0, -".recruitee.com".length),
      segments[1].toLowerCase(),
    );
  }
  return null;
}

/** The board a link's posting is on, or null when it isn't on one. */
export function parseAtsBoard(url: string): AtsBoard | null {
  try {
    return parseAtsLink(new URL(url))?.board ?? null;
  } catch {
    return null;
  }
}

/** One key per board, whichever link it came from. */
export function boardKey(board: AtsBoard): string {
  return `${board.ats}:${board.eu ? "eu:" : ""}${board.name.toLowerCase()}`;
}

/**
 * The system's API for one posting, where it has one: a posting it no
 * longer has is closed. Ashby, Workable and Recruitee only list a board's
 * open postings.
 */
export function postingApiUrl({ board, id }: AtsLink): string | null {
  switch (board.ats) {
    case "greenhouse":
      return `https://boards-api${board.eu ? ".eu" : ""}.greenhouse.io/v1/boards/${path(board.name, "jobs", id)}`;
    case "lever":
      return `https://api${board.eu ? ".eu" : ""}.lever.co/v0/postings/${path(board.name, id)}`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${path(board.name, "postings", id)}`;
    default:
      return null;
  }
}

/**
 * The system's API that lists a board's open postings. SmartRecruiters lists
 * a page at a time, so with `since` it lists only those released on or after
 * that day.
 */
export function boardApiUrl(board: AtsBoard, since?: string): string {
  switch (board.ats) {
    case "greenhouse":
      return `https://boards-api${board.eu ? ".eu" : ""}.greenhouse.io/v1/boards/${path(board.name, "jobs")}`;
    case "lever":
      return `https://api${board.eu ? ".eu" : ""}.lever.co/v0/postings/${path(board.name)}?mode=json`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${path(board.name, "postings")}?limit=100${since ? `&releasedAfter=${since}T00:00:00.000Z` : ""}`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${path(board.name)}`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${path(board.name)}`;
    case "recruitee":
      return `https://${board.name}.recruitee.com/api/offers/`;
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The list under `key`, or null when the answer isn't shaped as expected. */
function listAt(value: unknown, key: string | null): Json[] | null {
  const list = key === null ? value : isObject(value) ? value[key] : null;
  return Array.isArray(list) ? list.filter(isObject) : null;
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

/** A link from an API, when it's a public website. */
function publicLink(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return isPublicUrl(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** "remote", "hybrid", "onsite" or "on-site" as true or false; else null. */
function workplaceRemote(value: unknown): boolean | null {
  const workplace = text(value)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (workplace === "remote") return true;
  if (workplace === "hybrid" || workplace === "onsite") return false;
  return null;
}

/** Whether a location the board gives says remote. */
const saysRemote = (location: unknown) =>
  /\bremote\b|\banywhere\b|\bworldwide\b/i.test(text(location)) ? true : null;

/**
 * The open postings in a board's API answer, or null when it doesn't read
 * as that board's list.
 */
export function readBoard(
  board: AtsBoard,
  answer: unknown,
  clock: OwnerClock,
): BoardPosting[] | null {
  const day = (value: unknown) => postedDay(value, clock);
  const eu = board.eu ? ".eu" : "";
  const postings: (BoardPosting | null)[] | undefined = (() => {
    switch (board.ats) {
      case "greenhouse":
        return listAt(answer, "jobs")?.map((job) => {
          const id = text(job.id);
          if (!/^\d+$/.test(id)) return null;
          const own = publicLink(job.absolute_url);
          return {
            id,
            url:
              own && new URL(own).hostname.endsWith("greenhouse.io")
                ? own
                : `https://job-boards${eu}.greenhouse.io/${path(board.name, "jobs", id)}`,
            title: text(job.title),
            postedOn: day(job.first_published),
            remote: saysRemote(isObject(job.location) ? job.location.name : ""),
          };
        });
      case "lever":
        return listAt(answer, null)?.map((job) => {
          const id = text(job.id);
          if (!UUID.test(id)) return null;
          const categories = isObject(job.categories) ? job.categories : {};
          return {
            id,
            url:
              publicLink(job.hostedUrl) ??
              `https://jobs${eu}.lever.co/${path(board.name, id)}`,
            title: text(job.text),
            postedOn: day(job.createdAt),
            remote:
              workplaceRemote(job.workplaceType) ??
              saysRemote(categories.location),
          };
        });
      case "smartrecruiters":
        return listAt(answer, "content")?.map((job) => {
          const id = text(job.id);
          if (!/^\d{6,}$/.test(id)) return null;
          const location = isObject(job.location) ? job.location : {};
          return {
            id,
            url: `https://jobs.smartrecruiters.com/${path(board.name, id)}`,
            title: text(job.name),
            postedOn: day(job.releasedDate),
            remote:
              location.remote === true
                ? true
                : location.hybrid === true || location.remote === false
                  ? false
                  : null,
          };
        });
      case "ashby":
        return listAt(answer, "jobs")?.map((job) => {
          const id = text(job.id);
          if (!UUID.test(id)) return null;
          return {
            id,
            url:
              publicLink(job.jobUrl) ??
              `https://jobs.ashbyhq.com/${path(board.name, id)}`,
            title: text(job.title),
            postedOn: day(job.publishedAt),
            remote:
              workplaceRemote(job.workplaceType) ??
              (job.isRemote === true ? true : null),
          };
        });
      case "workable":
        return listAt(answer, "jobs")?.map((job) => {
          const id = text(job.shortcode).toUpperCase();
          if (!/^[0-9A-F]{6,}$/.test(id)) return null;
          return {
            id,
            url: `https://apply.workable.com/${path(board.name, "j", id)}`,
            title: text(job.title),
            postedOn: day(job.published_on ?? job.created_at),
            remote: job.telecommuting === true ? true : null,
          };
        });
      case "recruitee":
        return listAt(answer, "offers")?.map((offer) => {
          const id = text(offer.slug).toLowerCase();
          if (!id || (offer.status && offer.status !== "published"))
            return null;
          return {
            id,
            url:
              publicLink(offer.careers_url) ??
              `https://${board.name}.recruitee.com/o/${path(id)}`,
            title: text(offer.title),
            postedOn: day(offer.published_at ?? offer.created_at),
            remote:
              offer.remote === true
                ? true
                : offer.hybrid === true || offer.on_site === true
                  ? false
                  : null,
          };
        });
    }
  })();
  return (
    postings?.filter(
      (posting): posting is BoardPosting => !!posting && posting.title !== "",
    ) ?? null
  );
}

/** The day one posting's own API answer says it was posted. */
export function postingApiPostedOn(
  link: AtsLink,
  answer: unknown,
  clock: OwnerClock,
): string | null {
  if (!isObject(answer)) return null;
  switch (link.board.ats) {
    case "greenhouse":
      return postedDay(answer.first_published, clock);
    case "lever":
      return postedDay(answer.createdAt, clock);
    case "smartrecruiters":
      return postedDay(answer.releasedDate, clock);
    default:
      return null;
  }
}
