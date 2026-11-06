import "server-only";

import { eq, gt, inArray } from "drizzle-orm";

import { feedCheck, feedPosting } from "@/db/schema";
import { db } from "@/lib/dal/db";
import { postingLink } from "@/lib/jobs/canonical-url";
import {
  FEED_INTERVAL_MS,
  type FeedId,
  type FeedPosting,
} from "@/lib/jobs/feeds";

// The remote job boards' feeds, for the search run's Inngest steps, which
// run with no signed-in user.

/** Feeds asked for in the last FEED_INTERVAL_MS, and whether they answered. */
export async function recentFeedChecks(
  now: Date,
): Promise<{ feed: FeedId; ok: boolean }[]> {
  return db
    .select({ feed: feedCheck.feed, ok: feedCheck.ok })
    .from(feedCheck)
    .where(gt(feedCheck.checkedAt, new Date(now.getTime() - FEED_INTERVAL_MS)));
}

/**
 * Notes that a feed was asked for and, when it answered, keeps the postings
 * worth reading from it in place of the ones from its last answer.
 */
export async function saveFeedCheck(
  feed: FeedId,
  postings: FeedPosting[] | null,
  now: Date,
): Promise<void> {
  const rows = new Map<string, typeof feedPosting.$inferInsert>();
  for (const posting of postings ?? []) {
    const link = postingLink(posting.url);
    if (!link || rows.has(link.dedupeKey)) continue;
    rows.set(link.dedupeKey, {
      dedupeKey: link.dedupeKey,
      feed,
      canonicalUrl: link.canonicalUrl,
      applyUrl: posting.applyUrl,
      title: posting.title,
      company: posting.company,
      places: posting.places,
      postedOn: posting.postedOn,
      text: posting.text,
      fetchedAt: now,
    });
  }
  await db.transaction(async (tx) => {
    if (postings) {
      await tx.delete(feedPosting).where(eq(feedPosting.feed, feed));
      if (rows.size > 0) {
        // Another board can list the same link only in theory; its row stays.
        await tx
          .insert(feedPosting)
          .values([...rows.values()])
          .onConflictDoNothing({ target: feedPosting.dedupeKey });
      }
    }
    await tx
      .insert(feedCheck)
      .values({ feed, checkedAt: now, ok: postings !== null })
      .onConflictDoUpdate({
        target: feedCheck.feed,
        set: { checkedAt: now, ok: postings !== null },
      });
  });
}

/** The stored postings of the given feeds, without their text. */
export async function getFeedListings(
  feeds: FeedId[],
): Promise<Omit<FeedPosting, "text">[]> {
  if (feeds.length === 0) return [];
  const rows = await db
    .select({
      feed: feedPosting.feed,
      url: feedPosting.canonicalUrl,
      applyUrl: feedPosting.applyUrl,
      title: feedPosting.title,
      company: feedPosting.company,
      places: feedPosting.places,
      postedOn: feedPosting.postedOn,
    })
    .from(feedPosting)
    .where(inArray(feedPosting.feed, feeds));
  return rows;
}

/** One stored posting's text and where to apply, for reading it. */
export async function getFeedPosting(
  dedupeKey: string,
): Promise<{ text: string; applyUrl: string } | null> {
  const [row] = await db
    .select({ text: feedPosting.text, applyUrl: feedPosting.applyUrl })
    .from(feedPosting)
    .where(eq(feedPosting.dedupeKey, dedupeKey));
  return row ?? null;
}
