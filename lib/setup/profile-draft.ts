// The profile form setup shows, kept in this browser while it's typed in, so
// a reload doesn't lose it. It's the only part of setup the server doesn't
// keep, and it's cleared once the form is saved.
import { z } from "zod";

import type { MasterProfile } from "@/lib/schemas/profile";

export const PROFILE_DRAFT_KEY = "job-agent:setup-profile-draft";

// The form's shape with any text in it, since a draft is often unfinished:
// the real checks run when it's saved. `satisfies` keeps it in step with the
// profile, so a field added there has to be added here.
const text = z.string();
const highlight = z.object({ id: text, text });
const draftProfileSchema = z.object({
  basics: z.object({
    id: text,
    name: text,
    headline: text,
    email: text,
    phone: text,
    location: text,
    summary: text,
  }),
  links: z.array(z.object({ id: text, label: text, url: text })),
  experience: z.array(
    z.object({
      id: text,
      title: text,
      company: text,
      location: text,
      startDate: text,
      endDate: text,
      current: z.boolean(),
      summary: text,
      highlights: z.array(highlight),
      technologies: z.array(text),
    }),
  ),
  projects: z.array(
    z.object({
      id: text,
      name: text,
      role: text,
      url: text,
      startDate: text,
      endDate: text,
      summary: text,
      highlights: z.array(highlight),
      technologies: z.array(text),
    }),
  ),
  skills: z.array(z.object({ id: text, name: text, category: text })),
  education: z.array(
    z.object({
      id: text,
      institution: text,
      degree: text,
      field: text,
      startDate: text,
      endDate: text,
      details: text,
    }),
  ),
  certifications: z.array(
    z.object({ id: text, name: text, issuer: text, date: text, url: text }),
  ),
  languages: z.array(z.object({ id: text, name: text, level: text })),
}) satisfies z.ZodType<MasterProfile>;

/**
 * A draft belongs to the profile it started from (its basics id, or null for
 * an empty form), so a draft of an older profile never covers a newer CV.
 */
const storedDraftSchema = z.object({
  base: z.string().nullable(),
  values: draftProfileSchema,
});

/** The draft for the profile `base`, or null when there's none or it's someone else's. */
export function readProfileDraft(
  storage: Pick<Storage, "getItem">,
  base: string | null,
): MasterProfile | null {
  try {
    const raw = storage.getItem(PROFILE_DRAFT_KEY);
    if (!raw) return null;
    const stored = storedDraftSchema.safeParse(JSON.parse(raw));
    return stored.success && stored.data.base === base
      ? stored.data.values
      : null;
  } catch {
    return null;
  }
}

export function writeProfileDraft(
  storage: Pick<Storage, "setItem">,
  base: string | null,
  values: MasterProfile,
): void {
  try {
    storage.setItem(PROFILE_DRAFT_KEY, JSON.stringify({ base, values }));
  } catch {
    // Storage can be off or full; the draft just isn't kept.
  }
}

export function clearProfileDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(PROFILE_DRAFT_KEY);
  } catch {
    // Storage can be off; there's nothing to clear.
  }
}
