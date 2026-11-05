import { describe, expect, it } from "vitest";

import {
  defaultPreferences,
  emptyMasterProfile,
  type MasterProfile,
} from "@/lib/schemas/profile";
import type { EngineCheckView } from "@/lib/schemas/setup";
import profileFixture from "@/test/fixtures/profile.json";
import { samplePreferences } from "@/test/sample-preferences";

import {
  cvConfirmable,
  firstOpenStep,
  profileReady,
  providerPassed,
  shownStep,
  wantedSaved,
  type StepsDone,
} from "./progress";

const profile = profileFixture as MasterProfile;

const check = (overrides: Partial<EngineCheckView> = {}): EngineCheckView => ({
  id: "c1",
  engine: "claude_api",
  status: "passed",
  failure: null,
  message: null,
  model: "claude-haiku-5-5",
  durationMs: 900,
  createdAt: "2026-11-05T10:00:00.000Z",
  finishedAt: "2026-11-05T10:00:01.000Z",
  ...overrides,
});

describe("providerPassed", () => {
  const base = {
    chosen: true,
    engine: "claude_api" as const,
    check: check(),
    loginSavedAt: "2026-11-05T09:59:00.000Z",
  };

  it("passes once the picked engine's latest check passed after its key was saved", () => {
    expect(providerPassed(base)).toBe(true);
    expect(providerPassed({ ...base, loginSavedAt: null })).toBe(true);
  });

  it("needs the engine picked, not just the default", () => {
    expect(providerPassed({ ...base, chosen: false })).toBe(false);
  });

  it("needs a passed check on that engine", () => {
    expect(providerPassed({ ...base, check: null })).toBe(false);
    expect(
      providerPassed({ ...base, check: check({ status: "failed" }) }),
    ).toBe(false);
    expect(
      providerPassed({ ...base, check: check({ status: "running" }) }),
    ).toBe(false);
    expect(providerPassed({ ...base, engine: "claude_code" })).toBe(false);
  });

  it("asks for a new check when the key was saved after the last one", () => {
    expect(
      providerPassed({ ...base, loginSavedAt: "2026-11-05T10:05:00.000Z" }),
    ).toBe(false);
  });
});

describe("profileReady", () => {
  it("needs a name and a role, school or skill", () => {
    expect(profileReady(profile)).toBe(true);
    expect(profileReady(null)).toBe(false);
    const empty = emptyMasterProfile();
    expect(profileReady(empty)).toBe(false);
    expect(
      profileReady({ ...empty, basics: { ...empty.basics, name: "Alex" } }),
    ).toBe(false);
    expect(
      profileReady({
        ...empty,
        basics: { ...empty.basics, name: "Alex" },
        skills: [{ id: "skill_1", name: "React", category: "" }],
      }),
    ).toBe(true);
  });

  it("doesn't count a name of spaces", () => {
    expect(
      profileReady({ ...profile, basics: { ...profile.basics, name: "  " } }),
    ).toBe(false);
  });
});

describe("cvConfirmable", () => {
  const base = {
    path: "upload" as const,
    profile,
    uploadStatus: "succeeded" as const,
    atsCv: null,
    withoutAtsCv: false,
  };

  it("takes an upload once it's read, with or without the ATS-friendly CV", () => {
    expect(cvConfirmable(base)).toBe(true);
    expect(cvConfirmable({ ...base, uploadStatus: "failed" })).toBe(true);
    expect(
      cvConfirmable({
        ...base,
        atsCv: { status: "writing", outdated: false },
      }),
    ).toBe(true);
  });

  it("waits while a newer CV is still being read", () => {
    expect(cvConfirmable({ ...base, uploadStatus: "pending" })).toBe(false);
  });

  it("needs a path and a profile the agents can work from", () => {
    expect(cvConfirmable({ ...base, path: null })).toBe(false);
    expect(cvConfirmable({ ...base, profile: null })).toBe(false);
    expect(cvConfirmable({ ...base, profile: emptyMasterProfile() })).toBe(
      false,
    );
  });

  it("from the form, needs the ATS-friendly CV written from the profile as it is", () => {
    const form = { ...base, path: "form" as const, uploadStatus: null };
    expect(cvConfirmable(form)).toBe(false);
    expect(
      cvConfirmable({ ...form, atsCv: { status: "writing", outdated: false } }),
    ).toBe(false);
    expect(
      cvConfirmable({ ...form, atsCv: { status: "ready", outdated: false } }),
    ).toBe(true);
    expect(
      cvConfirmable({ ...form, atsCv: { status: "ready", outdated: true } }),
    ).toBe(false);
  });

  it("from the form, goes on without a failed CV only when asked to", () => {
    const failed = {
      ...base,
      path: "form" as const,
      uploadStatus: null,
      atsCv: { status: "failed" as const, outdated: false },
    };
    expect(cvConfirmable(failed)).toBe(false);
    expect(cvConfirmable({ ...failed, withoutAtsCv: true })).toBe(true);
  });
});

describe("wantedSaved", () => {
  it("needs countries, time zones and a stack", () => {
    expect(wantedSaved(null)).toBe(false);
    expect(wantedSaved(defaultPreferences)).toBe(false);
    expect(wantedSaved(samplePreferences)).toBe(false);
    expect(wantedSaved({ ...samplePreferences, stack: ["React"] })).toBe(true);
    expect(
      wantedSaved({ ...samplePreferences, stack: ["React"], timeZones: [] }),
    ).toBe(false);
  });
});

describe("firstOpenStep and shownStep", () => {
  const done = (...steps: (keyof StepsDone)[]): StepsDone => ({
    provider: steps.includes("provider"),
    cv: steps.includes("cv"),
    wanted: steps.includes("wanted"),
    ready: steps.includes("ready"),
  });

  it("opens at the first step that isn't done", () => {
    expect(firstOpenStep(done())).toBe("provider");
    expect(firstOpenStep(done("provider"))).toBe("cv");
    expect(firstOpenStep(done("provider", "cv"))).toBe("wanted");
    expect(firstOpenStep(done("provider", "cv", "wanted"))).toBe("ready");
    expect(firstOpenStep(done("provider", "cv", "wanted", "ready"))).toBe(
      "ready",
    );
  });

  it("shows a step asked for, back to any step before the open one", () => {
    const state = done("provider", "cv");
    expect(shownStep(null, state)).toBe("wanted");
    expect(shownStep("provider", state)).toBe("provider");
    expect(shownStep("cv", state)).toBe("cv");
    expect(shownStep("wanted", state)).toBe("wanted");
  });

  it("never skips ahead of the first open step", () => {
    expect(shownStep("ready", done("provider"))).toBe("cv");
    expect(shownStep("wanted", done())).toBe("provider");
  });

  it("opens the first step again when its check stops passing", () => {
    // The CV and answers stay done, but the provider needs a new check.
    expect(shownStep("ready", done("cv", "wanted"))).toBe("provider");
  });
});
