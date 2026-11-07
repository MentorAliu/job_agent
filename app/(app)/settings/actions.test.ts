import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNKNOWN_TIME_ZONE, type SettingsInput } from "@/lib/schemas/settings";

// The database is taken not to know America/Ciudad_Juarez, a newer name.
const saveSettings = vi.fn(
  async (values: SettingsInput) => values.timeZone !== "America/Ciudad_Juarez",
);
const refresh = vi.fn();
const scheduleMorningRuns = vi.fn<(timeZone: string) => Promise<void>>(
  async () => {},
);

vi.mock("@/lib/dal/settings", () => ({
  saveSettings: (values: SettingsInput) => saveSettings(values),
}));
vi.mock("@/inngest/clock", () => ({
  scheduleMorningRuns: (timeZone: string) => scheduleMorningRuns(timeZone),
}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { saveSettingsAction } = await import("./actions");

const valid: SettingsInput = {
  dailyRunEnabled: true,
  monthlyBudgetUsd: 10,
  agentEngine: "claude_api",
  timeZone: "Europe/Lisbon",
  cvTemplate: "executive",
};

describe("saveSettingsAction", () => {
  beforeEach(() => {
    saveSettings.mockClear();
    refresh.mockClear();
    scheduleMorningRuns.mockClear();
  });

  it("saves the parsed values, schedules the mornings in the time zone and refreshes the page", async () => {
    expect(await saveSettingsAction(valid)).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(valid);
    expect(scheduleMorningRuns).toHaveBeenCalledWith("Europe/Lisbon");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("drops fields Settings no longer has", async () => {
    await saveSettingsAction({ ...valid, runBudgetUsd: 0.5, models: {} });
    expect(saveSettings).toHaveBeenCalledWith(valid);
  });

  it("returns field errors and saves nothing when a value is wrong", async () => {
    const result = await saveSettingsAction({
      ...valid,
      monthlyBudgetUsd: 5000,
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { monthlyBudgetUsd: ["Use at most $1000."] },
      },
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("checks the time zone is one", async () => {
    const result = await saveSettingsAction({ ...valid, timeZone: "Lisbon" });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { timeZone: ["Pick a time zone from the list."] },
      },
    });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("says so when the database doesn't know the time zone", async () => {
    const result = await saveSettingsAction({
      ...valid,
      timeZone: "America/Ciudad_Juarez",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        formErrors: [],
        fieldErrors: { timeZone: [UNKNOWN_TIME_ZONE] },
      },
    });
    expect(scheduleMorningRuns).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects input that isn't a settings object at all", async () => {
    const result = await saveSettingsAction("daily");
    expect(result.ok).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
