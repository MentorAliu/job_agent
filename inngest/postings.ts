import type { BoardLink } from "@/lib/jobs/boards";
import type { PostingLink } from "@/lib/jobs/canonical-url";
import type { FeedLink } from "@/lib/jobs/feeds";
import { checkListing } from "@/lib/jobs/listing-check";
import type { OwnerClock } from "@/lib/jobs/today";

// What the search run and Add a role share once a posting is read.

/**
 * The day a posting went up, best source first: the company's board or the
 * feed it was found on, then the employer's tracking system or the page's own data
 * (plain HTTP, no Claude call), then what the page says.
 */
export async function postedOnFor(
  link: PostingLink | BoardLink | FeedLink,
  applyUrl: string | null,
  pageText: string | null,
  quoted: string | null,
  clock: OwnerClock,
): Promise<string | null> {
  if ("postedOn" in link && link.postedOn) return link.postedOn;
  const check = await checkListing(
    { canonicalUrl: link.canonicalUrl, applyUrl, description: pageText },
    { clock },
  );
  return check.postedOn ?? quoted;
}

/** A link Claude copied from a posting, if it's a web address. */
export function httpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
