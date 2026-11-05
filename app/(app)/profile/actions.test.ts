import { beforeEach, describe, expect, it, vi } from "vitest";

import { cvExtractionSchema, toMasterProfile } from "@/lib/schemas/profile";
import recorded from "@/test/fixtures/claude/parse-cv-response.json";
import { samplePreferences } from "@/test/sample-preferences";

const saveProfileData = vi.fn(async () => ({ snapshotId: "snap-1" }));
const savePreferences = vi.fn(async () => {});
const saveAnswers = vi.fn(async () => {});
const refresh = vi.fn();

class UnknownCvUploadError extends Error {}

vi.mock("@/lib/dal/profile", () => ({
  saveProfileData: (...args: unknown[]) => saveProfileData(...(args as [])),
  savePreferences: (...args: unknown[]) => savePreferences(...(args as [])),
  saveAnswers: (...args: unknown[]) => saveAnswers(...(args as [])),
  UnknownCvUploadError,
}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { saveProfileAction, savePreferencesAction } = await import("./actions");

const CV_FILE_ID = "4c3f7a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

/** The draft the review form is filled with after the recorded CV is read. */
function draft() {
  const text = recorded.body.content[0].text;
  return toMasterProfile(cvExtractionSchema.parse(JSON.parse(text)));
}

describe("saveProfileAction", () => {
  beforeEach(() => {
    saveProfileData.mockClear();
    refresh.mockClear();
  });

  it("saves the reviewed profile with its CV upload, then refreshes", async () => {
    const profile = draft();
    const result = await saveProfileAction(CV_FILE_ID, profile);

    expect(result).toEqual({ ok: true });
    expect(saveProfileData).toHaveBeenCalledWith(profile, CV_FILE_ID);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("trims values before saving", async () => {
    const profile = draft();
    profile.experience[0].title = "  Staff Engineer  ";
    await saveProfileAction(null, profile);

    const [saved] = saveProfileData.mock.calls[0] as unknown as [
      typeof profile,
    ];
    expect(saved.experience[0].title).toBe("Staff Engineer");
  });

  it("returns field errors and saves nothing when a field is invalid", async () => {
    const profile = draft();
    profile.experience[2].company = "";
    profile.skills[3].name = "";

    const result = await saveProfileAction(CV_FILE_ID, profile);

    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: {
          "experience.2.company": ["Enter the company."],
          "skills.3.name": ["Enter the skill or remove it."],
        },
      },
    });
    expect(saveProfileData).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects input that isn't a profile at all", async () => {
    const result = await saveProfileAction(null, { basics: "nope" });
    expect(result.ok).toBe(false);
    expect(saveProfileData).not.toHaveBeenCalled();
  });

  it("reports an unknown CV upload as a form error", async () => {
    saveProfileData.mockRejectedValueOnce(
      new UnknownCvUploadError("That CV upload doesn't exist."),
    );
    const result = await saveProfileAction(CV_FILE_ID, draft());
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: ["That CV upload doesn't exist."],
        fieldErrors: {},
      },
    });
  });

  it("rejects a CV upload id that isn't a UUID", async () => {
    const result = await saveProfileAction("../etc", draft());
    expect(result.ok).toBe(false);
    expect(saveProfileData).not.toHaveBeenCalled();
  });
});

describe("savePreferencesAction", () => {
  it("returns the nested field's error", async () => {
    const result = await savePreferencesAction({
      ...samplePreferences,
      salaryFloor: { amount: -5, currency: "EUR", period: "year" },
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { "salaryFloor.amount": ["Use a positive number."] },
      },
    });
    expect(savePreferences).not.toHaveBeenCalled();
  });
});
