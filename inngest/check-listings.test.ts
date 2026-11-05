import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing, ListingCheck } from "@/lib/jobs/listing-check";

// The daily listing check's step, with the database replaced by a list of
// roles and the HTTP checks by set verdicts.

const store = {
  roles: [] as (Listing & {
    id: string;
    status: string;
    postedOn?: string | null;
  })[],
  closed: [] as { id: string; reason: string }[],
};

vi.mock("@/lib/pipeline/listings", () => ({
  getListings: async (ids: string[]) =>
    store.roles.filter(
      (role) => ids.includes(role.id) && role.status !== "applied",
    ),
  closeListing: async (id: string, reason: string) => {
    const role = store.roles.find((row) => row.id === id);
    if (!role || role.status === "listing_closed") return false;
    role.status = "listing_closed";
    store.closed.push({ id, reason });
    return true;
  },
  savePostedOn: async (id: string, postedOn: string) => {
    const role = store.roles.find((row) => row.id === id);
    if (!role || role.postedOn) return false;
    role.postedOn = postedOn;
    return true;
  },
}));

vi.mock("@/lib/pipeline/setup", () => ({
  readOwnerTimeZone: async () => "Europe/Lisbon",
}));

const { checkStep } = await import("./check-listings");

const role = (id: string, status = "new") => ({
  id,
  status,
  canonicalUrl: `https://remotive.com/remote-jobs/dev/role-${id}`,
  applyUrl: null,
  description: null,
});

beforeEach(() => {
  store.roles = [];
  store.closed = [];
});

describe("checking a batch of listings", () => {
  it("moves only the roles whose listing reads as closed", async () => {
    store.roles = [
      role("a"),
      role("b", "ready"),
      role("c"),
      role("d", "applied"),
    ];
    const verdicts: Record<string, ListingCheck> = {
      a: { verdict: "closed", fromAts: true, reason: "Lever says so." },
      b: { verdict: "closed", fromAts: false, reason: "The page is gone." },
      c: { verdict: "unknown", fromAts: false, reason: "" },
      d: { verdict: "closed", fromAts: true, reason: "Applied already." },
    };
    const check = vi.fn(async (listing: Listing) => {
      const id = listing.canonicalUrl.split("-").at(-1)!;
      return verdicts[id];
    });

    expect(await checkStep(["a", "b", "c", "d"], check)).toEqual({
      closed: 2,
      unknown: 1,
      dated: 0,
    });
    expect(store.closed).toEqual([
      { id: "a", reason: "Lever says so." },
      { id: "b", reason: "The page is gone." },
    ]);
    // Roles already sent aren't checked at all.
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("dates the roles that have no posting date yet", async () => {
    store.roles = [
      role("a"),
      { ...role("b"), postedOn: "2026-10-01" },
      role("c"),
    ];
    const check = async (listing: Listing): Promise<ListingCheck> =>
      listing.canonicalUrl.endsWith("-c")
        ? { verdict: "open", fromAts: false, reason: "" }
        : {
            verdict: "open",
            fromAts: true,
            reason: "",
            postedOn: "2026-10-20",
          };

    expect(await checkStep(["a", "b", "c"], check)).toMatchObject({
      dated: 1,
    });
    expect(store.roles.map((entry) => entry.postedOn ?? null)).toEqual([
      "2026-10-20",
      // A date it already has stays.
      "2026-10-01",
      null,
    ]);
  });

  it("shares one cache across the batch, so a board is fetched once", async () => {
    store.roles = [role("a"), role("b")];
    const caches = new Set<unknown>();
    await checkStep(["a", "b"], async (_listing, options) => {
      caches.add(options?.cache);
      return { verdict: "open", fromAts: false, reason: "" };
    });
    expect(caches.size).toBe(1);
    expect([...caches][0]).toBeInstanceOf(Map);
  });

  it("reads posting dates in the owner's time zone", async () => {
    store.roles = [role("a")];
    const zones: string[] = [];
    await checkStep(["a"], async (_listing, options) => {
      zones.push(options.clock.timeZone);
      return { verdict: "open", fromAts: false, reason: "" };
    });
    expect(zones).toEqual(["Europe/Lisbon"]);
  });
});
