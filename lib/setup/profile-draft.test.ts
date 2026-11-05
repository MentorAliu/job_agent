import { describe, expect, it } from "vitest";

import { emptyMasterProfile, type MasterProfile } from "@/lib/schemas/profile";
import profileFixture from "@/test/fixtures/profile.json";

import {
  clearProfileDraft,
  PROFILE_DRAFT_KEY,
  readProfileDraft,
  writeProfileDraft,
} from "./profile-draft";

const profile = profileFixture as MasterProfile;

/** A Storage stand-in, backed by a Map. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** Storage that's turned off: every call throws, as in some private windows. */
const blockedStorage = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("profile drafts", () => {
  it("gives back what was typed, for the profile it started from", () => {
    const storage = memoryStorage();
    writeProfileDraft(storage, profile.basics.id, profile);
    expect(readProfileDraft(storage, profile.basics.id)).toEqual(profile);
  });

  it("keeps an unfinished form, such as a role with no title yet", () => {
    const storage = memoryStorage();
    const empty = emptyMasterProfile();
    const draft: MasterProfile = {
      ...empty,
      basics: { ...empty.basics, name: "Alex" },
      experience: [
        {
          id: "role_1",
          title: "",
          company: "",
          location: "",
          startDate: "2021-1",
          endDate: "",
          current: true,
          summary: "",
          highlights: [],
          technologies: [],
        },
      ],
    };
    writeProfileDraft(storage, null, draft);
    expect(readProfileDraft(storage, null)).toEqual(draft);
  });

  it("never covers another profile with a draft of an older one", () => {
    const storage = memoryStorage();
    writeProfileDraft(storage, "basics_older", profile);
    expect(readProfileDraft(storage, profile.basics.id)).toBeNull();
    expect(readProfileDraft(storage, null)).toBeNull();
  });

  it("ignores what isn't a draft", () => {
    const storage = memoryStorage();
    storage.setItem(PROFILE_DRAFT_KEY, "{not json");
    expect(readProfileDraft(storage, null)).toBeNull();
    storage.setItem(
      PROFILE_DRAFT_KEY,
      JSON.stringify({ base: null, values: { basics: {} } }),
    );
    expect(readProfileDraft(storage, null)).toBeNull();
    expect(readProfileDraft(memoryStorage(), null)).toBeNull();
  });

  it("is cleared once the form is saved", () => {
    const storage = memoryStorage();
    writeProfileDraft(storage, null, profile);
    clearProfileDraft(storage);
    expect(storage.items.size).toBe(0);
  });

  it("does nothing when storage is turned off", () => {
    expect(() =>
      writeProfileDraft(blockedStorage, null, profile),
    ).not.toThrow();
    expect(readProfileDraft(blockedStorage, null)).toBeNull();
    expect(() => clearProfileDraft(blockedStorage)).not.toThrow();
  });
});
