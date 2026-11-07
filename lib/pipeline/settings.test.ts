import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { profile, settings } from "@/db/schema";
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_SEARCH_DOMAINS,
  DEFAULT_STAGE_MODELS,
  type SettingsRowInput,
} from "@/lib/schemas/settings";

// The settings row and the profile row in memory, behind the few Drizzle
// calls that read and save them. Everything above the database is real.
const store: {
  settings: Record<string, unknown> | null;
  profile: Record<string, unknown>;
} = { settings: null, profile: {} };

vi.mock("@/lib/dal/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === settings) return store.settings ? [store.settings] : [];
          if (table === profile) return [store.profile];
          throw new Error("Unexpected table.");
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: object }) => {
          if (table !== settings) throw new Error("Unexpected table.");
          store.settings = store.settings
            ? { ...store.settings, ...set }
            : { prices: null, ...values };
        },
      }),
    }),
  },
}));

const { defaultEngine, readSettings, resolveSettings, writeSettings } =
  await import("./settings");
const { getBudgetLimits } = await import("./budget");
const { getSearchInputs } = await import("./runs");
const { getStageSetup } = await import("@/lib/claude/llm-call");

const saved: SettingsRowInput = {
  dailyRunEnabled: false,
  monthlyBudgetUsd: 5,
  agentEngine: "claude_api",
};

describe("Settings", () => {
  beforeEach(() => {
    store.settings = null;
    store.profile = { data: null, preferences: null };
    vi.stubEnv("MONTHLY_BUDGET_USD", "");
    vi.stubEnv("RUN_BUDGET_USD", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the defaults before Settings is first saved", async () => {
    expect(await readSettings()).toMatchObject({
      saved: false,
      dailyRunEnabled: true,
      searchDomains: DEFAULT_SEARCH_DOMAINS,
      models: DEFAULT_STAGE_MODELS,
      prices: DEFAULT_PRICE_TABLE,
    });
    expect(await getBudgetLimits()).toEqual({ monthlyUsd: 20, runUsd: 1 });
  });

  it("takes the monthly cap from .env until Settings is saved", async () => {
    vi.stubEnv("MONTHLY_BUDGET_USD", "12");
    vi.stubEnv("RUN_BUDGET_USD", "0.5");
    expect(await getBudgetLimits()).toEqual({ monthlyUsd: 12, runUsd: 0.5 });

    await writeSettings(saved);
    // The per-run cap isn't in Settings, so it still comes from .env.
    expect(await getBudgetLimits()).toEqual({ monthlyUsd: 5, runUsd: 0.5 });
  });

  it("applies saved changes to what the next run reads", async () => {
    expect((await getSearchInputs()).dailyRunEnabled).toBe(true);

    await writeSettings(saved);

    // What a run's start step and its budget checks read.
    expect(await getSearchInputs()).toMatchObject({
      dailyRunEnabled: false,
      domains: DEFAULT_SEARCH_DOMAINS,
    });
    expect(await getBudgetLimits()).toEqual({ monthlyUsd: 5, runUsd: 1 });

    // Saving again replaces the row's values.
    await writeSettings({ ...saved, dailyRunEnabled: true });
    expect((await getSearchInputs()).dailyRunEnabled).toBe(true);
  });

  it("ignores the domains, models and run cap older versions saved", async () => {
    store.settings = {
      dailyRunEnabled: true,
      monthlyBudgetUsd: 20,
      runBudgetUsd: 0.1,
      searchDomains: ["lever.co"],
      models: { ...DEFAULT_STAGE_MODELS, score: "claude-sonnet-5-5" },
      prices: null,
    };
    expect(await getBudgetLimits()).toEqual({ monthlyUsd: 20, runUsd: 1 });
    expect((await getSearchInputs()).domains).toEqual(DEFAULT_SEARCH_DOMAINS);
    expect(await getStageSetup("score")).toMatchObject({
      model: "claude-haiku-5-5",
      price: DEFAULT_PRICE_TABLE.models["claude-haiku-5-5"],
    });
  });
});

describe("resolveSettings", () => {
  it("falls back to the default prices when the saved ones don't parse", () => {
    const resolved = resolveSettings(
      {
        dailyRunEnabled: true,
        monthlyBudgetUsd: 20,
        agentEngine: "claude_api",
        prices: { models: "none" } as never,
        cvTemplate: null,
      },
      {},
    );
    expect(resolved.prices).toEqual(DEFAULT_PRICE_TABLE);
    expect(resolved.saved).toBe(true);
  });

  it("ignores a cap in .env that isn't a number", () => {
    expect(
      resolveSettings(null, { MONTHLY_BUDGET_USD: "lots" }).monthlyBudgetUsd,
    ).toBe(20);
  });

  it("runs on the engine setup picked until Settings is saved", () => {
    const env = { AGENT_ENGINE: "codex", ANTHROPIC_API_KEY: "sk-ant-key" };
    expect(resolveSettings(null, env).agentEngine).toBe("codex");
    expect(
      resolveSettings(
        {
          dailyRunEnabled: true,
          monthlyBudgetUsd: 20,
          agentEngine: "claude_api",
          prices: null,
          cvTemplate: null,
        },
        env,
      ).agentEngine,
    ).toBe("claude_api");
  });
});

describe("defaultEngine", () => {
  it("takes AGENT_ENGINE when it names an engine", () => {
    expect(defaultEngine({ AGENT_ENGINE: "openai_api" })).toBe("openai_api");
    expect(
      defaultEngine({ AGENT_ENGINE: "gpt", ANTHROPIC_API_KEY: "sk-ant-key" }),
    ).toBe("claude_api");
  });

  it("otherwise picks a plan's agent before an API", () => {
    expect(
      defaultEngine({
        CLAUDE_CODE_OAUTH_TOKEN: "token",
        ANTHROPIC_API_KEY: "sk-ant-key",
      }),
    ).toBe("claude_code");
    expect(defaultEngine({ ANTHROPIC_API_KEY: "sk-ant-key" })).toBe(
      "claude_api",
    );
    expect(defaultEngine({ OPENAI_API_KEY: "sk-key" })).toBe("openai_api");
    expect(defaultEngine({})).toBe("claude_code");
  });
});
