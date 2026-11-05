// Each search first checks the job boards of companies that already posted a
// role the owner can take. A company that hires from where the owner lives
// often does again, and its new postings turn up here the day they go up,
// before a web search finds them. Plain HTTP to each system's public API, no
// Claude call, so it costs nothing until a posting is read.
import {
  boardApiUrl,
  boardKey,
  parseAtsBoard,
  readBoard,
  type AtsBoard,
  type BoardPosting,
} from "./ats";
import { postingLink, type PostingLink } from "./canonical-url";
import { isExcludedCompany } from "./companies";
import { freshnessAge, isStale, STALE_DAYS } from "./posted";
import { fetchPublic, parseJson, type FetchOptions } from "./public-fetch";
import { boardTitleRank } from "./role-focus";
import { addDays, type OwnerClock } from "./today";

/** Company boards checked per search, the companies found most recently first. */
export const MAX_WATCHED_BOARDS = 40;
/** New postings from the boards read per search, so the web searches still get their turn. */
export const BOARD_POSTINGS_PER_RUN = 10;
/** Boards asked at the same time. */
export const BOARDS_AT_ONCE = 8;

/** A posting found on a company's board, with the day the board says it went up. */
export type BoardLink = PostingLink & { postedOn: string | null };

type RoleLinks = {
  canonicalUrl: string;
  applyUrl: string | null;
  company: string;
};

/**
 * The boards to check: those behind roles the owner can take, newest role
 * first, one per company board, leaving out companies the owner excluded.
 */
export function watchedBoards(
  roles: RoleLinks[],
  excludedCompanies: string[],
  limit = MAX_WATCHED_BOARDS,
): AtsBoard[] {
  const boards = new Map<string, AtsBoard>();
  for (const role of roles) {
    if (isExcludedCompany(role.company, excludedCompanies)) continue;
    for (const url of [role.canonicalUrl, role.applyUrl]) {
      const board = url ? parseAtsBoard(url) : null;
      if (!board || boards.has(boardKey(board))) continue;
      if (boards.size < limit) boards.set(boardKey(board), board);
    }
  }
  return [...boards.values()];
}

/** A board's open postings, or null when its API couldn't be read. */
export async function fetchBoardPostings(
  board: AtsBoard,
  clock: OwnerClock,
  options: FetchOptions = {},
): Promise<BoardPosting[] | null> {
  const response = await fetchPublic(
    boardApiUrl(board, addDays(clock.today, -STALE_DAYS)),
    "application/json",
    options,
  );
  if (!response.ok || response.status < 200 || response.status >= 300) {
    return null;
  }
  return readBoard(board, parseJson(response.text), clock);
}

export type RankedBoardLink = BoardLink & {
  /** From boardTitleRank: the kind wanted 0, kinds near it 1, unnamed developer roles 2. */
  rank: number;
  remote: boolean | null;
};

/**
 * The postings worth reading: developer roles the owner wants by their
 * title, not hybrid or on-site by what the board says, and not too old for
 * a kit. One link per posting.
 */
export function boardLinks(
  postings: BoardPosting[],
  today: string,
  wanted: Parameters<typeof boardTitleRank>[1],
): RankedBoardLink[] {
  const links = new Map<string, RankedBoardLink>();
  for (const posting of postings) {
    const rank = boardTitleRank(posting.title, wanted);
    if (rank === null || posting.remote === false) continue;
    if (isStale(posting.postedOn, today)) continue;
    const link = postingLink(posting.url);
    if (!link || links.has(link.dedupeKey)) continue;
    links.set(link.dedupeKey, {
      ...link,
      postedOn: posting.postedOn,
      rank,
      remote: posting.remote,
    });
  }
  return [...links.values()];
}

/**
 * The postings to read this search: the kind of role the owner wants first,
 * then the kinds near it, then developer roles that don't say; in each, the
 * ones the board says are remote first, then the newest.
 */
export function pickBoardLinks(
  links: RankedBoardLink[],
  today: string,
  limit = BOARD_POSTINGS_PER_RUN,
): BoardLink[] {
  return [...links]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.remote === true) - Number(a.remote === true) ||
        freshnessAge(a.postedOn, today) - freshnessAge(b.postedOn, today),
    )
    .slice(0, limit)
    .map(({ canonicalUrl, dedupeKey, postedOn }) => ({
      canonicalUrl,
      dedupeKey,
      postedOn,
    }));
}
