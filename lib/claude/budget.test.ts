import { beforeEach, describe, expect, it, vi } from "vitest";

const spend = { month: 0, run: 0 };
const limits = { monthlyUsd: 20, runUsd: 1 };

vi.mock("@/lib/pipeline/budget", () => ({
  getBudgetLimits: async () => limits,
  getMonthSpendUsd: async () => spend.month,
  getRunSpendUsd: async () => spend.run,
}));

const { assertWithinBudget, BudgetExceededError, getBudgetState } =
  await import("./budget");

const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

describe("assertWithinBudget", () => {
  beforeEach(() => {
    spend.month = 0;
    spend.run = 0;
    limits.monthlyUsd = 20;
    limits.runUsd = 1;
  });

  it("lets a call through while it fits under both caps", async () => {
    spend.month = 5;
    spend.run = 0.5;
    await expect(assertWithinBudget(0.4, RUN_ID)).resolves.toBeUndefined();
  });

  it("stops a run at its own cap and says why", async () => {
    spend.run = 0.98;
    const error = await assertWithinBudget(0.035, RUN_ID).catch((e) => e);
    expect(error).toBeInstanceOf(BudgetExceededError);
    expect(error).toMatchObject({
      scope: "run",
      message:
        "Stopped at the $1.00 per-run budget set in Settings, after spending $0.98.",
    });
  });

  it("stops any call once the month's spend reaches the monthly cap", async () => {
    spend.month = 19.99;
    const error = await assertWithinBudget(0.2).catch((e) => e);
    expect(error).toMatchObject({
      scope: "monthly",
      message:
        "This month's API spend ($19.99) is at the $20.00 monthly budget set in Settings.",
    });
  });

  it("names whichever cap is closer", async () => {
    spend.month = 19.5;
    spend.run = 0.1;
    expect(await getBudgetState(RUN_ID)).toMatchObject({
      remainingUsd: 0.5,
      scope: "monthly",
    });
    expect(await getBudgetState()).toMatchObject({ scope: "monthly" });
  });
});
