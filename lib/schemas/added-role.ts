import { z } from "zod";

import { OFF_LIMITS_JOB_SITES } from "./settings";

// A role the owner adds by hand, from a link and, where the app can't read
// the page, the posting's text. It goes through the same reading, checks and
// score as a role a search finds.

export const ADDED_ROLE_STATUSES = ["reading", "done", "failed"] as const;
export type AddedRoleStatus = (typeof ADDED_ROLE_STATUSES)[number];

/** An added role still marked reading after this long never finished. */
export const ADDED_ROLE_STALE_MS = 15 * 60 * 1000;

/** Enough for a long posting; a whole page with its menus fits too. */
export const ADDED_ROLE_MAX_CHARS = 60_000;
/** Less than this isn't a posting's text. */
const MIN_TEXT_CHARS = 200;

/** The job site a link is on when its terms forbid apps to read its pages, else null. */
export function offLimitsSite(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      OFF_LIMITS_JOB_SITES.find(
        (site) => host === site || host.endsWith(`.${site}`),
      ) ?? null
    );
  } catch {
    return null;
  }
}

export const addRoleSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "Paste the link to the posting.")
      .pipe(
        z.url({
          protocol: /^https?$/,
          hostname: z.regexes.domain,
          error: "Paste the posting's whole link, starting with https://.",
        }),
      ),
    text: z
      .string()
      .trim()
      .max(
        ADDED_ROLE_MAX_CHARS,
        `Paste at most ${ADDED_ROLE_MAX_CHARS.toLocaleString("en")} characters.`,
      )
      .refine(
        (value) => value === "" || value.length >= MIN_TEXT_CHARS,
        "Paste the whole posting, not just its title.",
      ),
  })
  .superRefine(({ url, text }, context) => {
    const site = offLimitsSite(url);
    if (site && text === "") {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: `${site} doesn't allow apps to read its pages. Paste the posting's text here.`,
      });
    }
  });
export type AddRoleInput = z.input<typeof addRoleSchema>;
export type AddRole = z.output<typeof addRoleSchema>;
