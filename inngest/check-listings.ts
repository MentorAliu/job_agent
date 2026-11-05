import {
  checkListing,
  type CheckOptions,
  type ListingCheck,
} from "@/lib/jobs/listing-check";
import { ownerClock } from "@/lib/jobs/today";
import {
  closeListing,
  getListingIds,
  getListings,
  savePostedOn,
} from "@/lib/pipeline/listings";
import { readOwnerTimeZone } from "@/lib/pipeline/setup";

import { inngest } from "./client";
import { MOVED_TIME_ZONE, stillScheduled } from "./clock";
import { listingsCheckDue } from "./events";

/** Roles checked at the same time, in one step. */
export const CHECKS_PER_STEP = 10;

/**
 * Checks one batch of roles and moves the ones whose listing closed. Roles
 * with no posting date get the one the check read. Each role is read inside
 * the step, so no posting text lands in Inngest's step history.
 */
export async function checkStep(
  ids: string[],
  check: typeof checkListing = checkListing,
): Promise<{ closed: number; unknown: number; dated: number }> {
  const [listings, timeZone] = await Promise.all([
    getListings(ids),
    readOwnerTimeZone(),
  ]);
  const options: CheckOptions = {
    cache: new Map(),
    clock: ownerClock(timeZone),
  };
  const results: { id: string; result: ListingCheck }[] = await Promise.all(
    listings.map(async (listing) => ({
      id: listing.id,
      result: await check(listing, options),
    })),
  );
  let closed = 0;
  let dated = 0;
  for (const { id, result } of results) {
    if (result.verdict === "closed" && (await closeListing(id, result.reason)))
      closed++;
    if (result.postedOn && (await savePostedOn(id, result.postedOn))) dated++;
  }
  return {
    closed,
    unknown: results.filter(({ result }) => result.verdict === "unknown")
      .length,
    dated,
  };
}

/**
 * Every morning at 06:30 in the owner's time zone, scheduled by the morning
 * clock (inngest/clock.ts), before the 07:00 search picks roles for kits:
 * moves roles not yet sent whose listing the employer closed to Listing
 * closed, and dates the ones with no posting date yet. Plain HTTP requests,
 * no Claude calls.
 */
export const checkListings = inngest.createFunction(
  {
    id: "check-listings",
    name: "Check listings are still open",
    triggers: [listingsCheckDue],
  },
  async ({ event, step }) => {
    const ids = await step.run("list", async () =>
      (await stillScheduled(event.data.timeZone)) ? getListingIds() : null,
    );
    if (!ids) return { skipped: MOVED_TIME_ZONE };
    let closed = 0;
    let unknown = 0;
    let dated = 0;
    for (let first = 0; first < ids.length; first += CHECKS_PER_STEP) {
      const batch = ids.slice(first, first + CHECKS_PER_STEP);
      const result = await step.run(
        `check-${first / CHECKS_PER_STEP + 1}`,
        () => checkStep(batch),
      );
      closed += result.closed;
      unknown += result.unknown;
      dated += result.dated;
    }
    return { checked: ids.length, closed, unknown, dated };
  },
);
