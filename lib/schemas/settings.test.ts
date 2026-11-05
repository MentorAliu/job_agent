import { describe, expect, it } from "vitest";

import { toFieldErrors } from "./action";
import {
  codexLoginInputSchema,
  isCliEngine,
  isOtherEngine,
  openAiKeyInputSchema,
  openAiModel,
  searchDomainGroups,
  settingsInputSchema,
  type SettingsInput,
} from "./settings";

const valid: SettingsInput = {
  dailyRunEnabled: true,
  monthlyBudgetUsd: 20,
  agentEngine: "claude_api",
  timeZone: "Europe/Belgrade",
};

describe("settingsInputSchema", () => {
  it("accepts the defaults", () => {
    expect(settingsInputSchema.parse(valid)).toEqual(valid);
  });

  it("takes a time zone name, without spaces around it", () => {
    expect(
      settingsInputSchema.parse({ ...valid, timeZone: " America/New_York " })
        .timeZone,
    ).toBe("America/New_York");
    for (const timeZone of ["", "Belgrade", "GMT+1:00 Belgrade"]) {
      const result = settingsInputSchema.safeParse({ ...valid, timeZone });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(toFieldErrors(result.error).fieldErrors).toEqual({
          timeZone: ["Pick a time zone from the list."],
        });
      }
    }
  });

  it("says what to enter when the budget is left empty", () => {
    const result = settingsInputSchema.safeParse({
      ...valid,
      monthlyBudgetUsd: Number.NaN,
    });
    expect(toFieldErrors(result.error!).fieldErrors.monthlyBudgetUsd).toEqual([
      "Enter an amount in US dollars.",
    ]);
  });

  it("allows a budget of 0, which stops all Claude API calls", () => {
    expect(
      settingsInputSchema.safeParse({ ...valid, monthlyBudgetUsd: 0 }).success,
    ).toBe(true);
  });

  it("keeps the budget between $0 and $1000", () => {
    expect(
      toFieldErrors(
        settingsInputSchema.safeParse({ ...valid, monthlyBudgetUsd: -1 })
          .error!,
      ).fieldErrors,
    ).toEqual({ monthlyBudgetUsd: ["Use 0 or more."] });
    expect(
      settingsInputSchema.safeParse({ ...valid, monthlyBudgetUsd: 1001 })
        .success,
    ).toBe(false);
  });

  it("takes one of the three engines", () => {
    for (const agentEngine of ["claude_api", "claude_code", "codex"]) {
      expect(
        settingsInputSchema.safeParse({ ...valid, agentEngine }).success,
      ).toBe(true);
    }
    expect(
      toFieldErrors(
        settingsInputSchema.safeParse({ ...valid, agentEngine: "gemini" })
          .error!,
      ).fieldErrors,
    ).toEqual({ agentEngine: ["Pick what the agents run on."] });
  });
});

describe("codexLoginInputSchema", () => {
  const signIn = (authJson: string) =>
    codexLoginInputSchema.safeParse({ authJson });

  it("takes a ChatGPT sign-in or an API key, as codex login writes them", () => {
    expect(
      signIn(
        JSON.stringify({
          auth_mode: "chatgpt",
          OPENAI_API_KEY: null,
          tokens: {
            id_token: "header.payload.signature",
            access_token: "header.payload.signature",
            refresh_token: "rt_fixture",
            account_id: "account-1",
          },
          last_refresh: "2026-10-29T10:00:00Z",
        }),
      ).success,
    ).toBe(true);
    expect(signIn('{ "OPENAI_API_KEY": "sk-fixture" }').success).toBe(true);
  });

  it("says what's wrong with anything else", () => {
    const errors = (authJson: string) =>
      toFieldErrors(signIn(authJson).error!).fieldErrors.authJson;
    expect(errors("  ")).toEqual(["Paste the contents of auth.json."]);
    expect(errors("not json")).toEqual([
      "That isn't Codex's auth.json. Run codex login, then paste the whole file.",
    ]);
    expect(errors('{ "tokens": null, "OPENAI_API_KEY": "" }')).toHaveLength(1);
  });
});

describe("openAiKeyInputSchema", () => {
  const key = (apiKey: string) => openAiKeyInputSchema.safeParse({ apiKey });

  it("takes a key as OpenAI's dashboard shows it, trimmed", () => {
    expect(key("  sk-proj-Ab3_dEf-ghIjkLmnOpqrStuv12  ").data).toEqual({
      apiKey: "sk-proj-Ab3_dEf-ghIjkLmnOpqrStuv12",
    });
  });

  it("says what's wrong with anything else", () => {
    const errors = (apiKey: string) =>
      toFieldErrors(key(apiKey).error!).fieldErrors.apiKey;
    expect(errors(" ")).toEqual(["Paste your OpenAI API key."]);
    expect(errors("hello there")).toEqual([
      "That doesn't look like an OpenAI API key, which starts with sk-. Check you copied all of it.",
    ]);
    expect(errors("sk-short")).toHaveLength(1);
  });
});

describe("engines", () => {
  it("tells the plans' command-line agents from the paid APIs", () => {
    expect(isCliEngine("claude_code")).toBe(true);
    expect(isCliEngine("codex")).toBe(true);
    expect(isCliEngine("openai_api")).toBe(false);
    expect(isCliEngine("claude_api")).toBe(false);
    expect(isOtherEngine("openai_api")).toBe(true);
    expect(isOtherEngine("claude_api")).toBe(false);
  });

  it("stands GPT-6.1 Sol in for Sonnet and GPT-6 Luna for Haiku", () => {
    expect(openAiModel("claude-sonnet-5-5")).toBe("gpt-6.1-sol");
    expect(openAiModel("claude-haiku-5-5")).toBe("gpt-6-luna");
    expect(openAiModel("claude-haiku-4-5")).toBe("gpt-6-luna");
    expect(openAiModel("claude-opus-5-5")).toBe("gpt-6.1-sol");
  });
});

describe("searchDomainGroups", () => {
  it("splits the domains into groups of four", () => {
    expect(
      searchDomainGroups(["a.co", "b.co", "c.co", "d.co", "e.co"]),
    ).toEqual([["a.co", "b.co", "c.co", "d.co"], ["e.co"]]);
  });
});
