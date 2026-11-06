// The remote job boards whose own feeds each search reads (lib/jobs/feeds.ts),
// apart from the reader so the role pages can name the board too.

export const FEED_IDS = [
  "remoteok",
  "weworkremotely",
  "jobicy",
  "himalayas",
] as const;
export type FeedId = (typeof FEED_IDS)[number];

export type Feed = {
  /** The board's name, which its terms ask apps to show as the source. */
  name: string;
  /** The board's site. A site whose feed was read isn't searched again in that run. */
  site: string;
};

export const FEEDS: Record<FeedId, Feed> = {
  remoteok: { name: "Remote OK", site: "remoteok.com" },
  weworkremotely: { name: "We Work Remotely", site: "weworkremotely.com" },
  jobicy: { name: "Jobicy", site: "jobicy.com" },
  himalayas: { name: "Himalayas", site: "himalayas.app" },
};

/** The board a posting link is on, when the app reads that board's feed. */
export function feedFor(url: string): FeedId | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    FEED_IDS.find(
      (id) => host === FEEDS[id].site || host.endsWith(`.${FEEDS[id].site}`),
    ) ?? null
  );
}

/** The name of the feed board a link is on, such as "Remote OK", or null. */
export function feedBoardName(url: string | null): string | null {
  const feed = url ? feedFor(url) : null;
  return feed ? FEEDS[feed].name : null;
}
