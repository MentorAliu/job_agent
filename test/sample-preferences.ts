import { defaultPreferences, type Preferences } from "@/lib/schemas/profile";

/**
 * Job preferences for tests: a remote frontend developer in Montenegro, so the
 * tests cover a country outside the EU and a time zone with summer time.
 */
export const samplePreferences: Preferences = {
  ...defaultPreferences,
  countries: ["Montenegro"],
  timeZones: ["Europe/Belgrade"],
  roleFocus: "frontend",
};
