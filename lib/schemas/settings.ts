// App settings. The owner sets the daily search, the monthly budget and what
// the agents run on, kept in the one `settings` row, and their time zone,
// kept with first-run setup. The models, search domains and per-run budget
// are fixed here, so there's nothing else to tune.
import { z } from "zod";

import { timeZoneName } from "@/lib/jobs/today";

/** Pipeline stages that call Claude. Matches the `llm_stage` enum. */
export const LLM_STAGES = [
  "parse_cv",
  "discover",
  "extract",
  "score",
  "company_snapshot",
  "tailor",
  "claim_check",
  "read_email",
  "build_cv",
  "check_engine",
] as const;

export type LlmStage = (typeof LLM_STAGES)[number];

/**
 * The steps behind a search, an apply kit, reading and building CVs,
 * reading employers' replies and checking the provider, for the spend views.
 */
export const STAGE_GROUPS = {
  searching: ["discover", "extract", "score"],
  kits: ["company_snapshot", "tailor", "claim_check"],
  cv: ["parse_cv", "build_cv"],
  email: ["read_email"],
  checks: ["check_engine"],
} as const satisfies Record<string, readonly LlmStage[]>;

export type StageGroup = keyof typeof STAGE_GROUPS;

/** Display names for the models in the default price table. */
const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-luna": "GPT-6 Luna",
  codex: "Codex",
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

/** A model id for each stage. */
export type StageModels = Record<LlmStage, string>;

/** The model each stage uses (SPEC "How the agent works"). */
export const DEFAULT_STAGE_MODELS: StageModels = {
  parse_cv: "claude-sonnet-5-5",
  discover: "claude-haiku-5-5",
  extract: "claude-haiku-5-5",
  score: "claude-haiku-5-5",
  company_snapshot: "claude-haiku-5-5",
  tailor: "claude-sonnet-5-5",
  claim_check: "claude-haiku-5-5",
  read_email: "claude-sonnet-5-5",
  build_cv: "claude-sonnet-5-5",
  check_engine: "claude-haiku-5-5",
};

/**
 * On the OpenAI API, the model that stands in for each Claude model, at the
 * same prices: GPT-6.1 Sol for Sonnet 5.5, GPT-6 Luna for Haiku 5.5.
 */
const OPENAI_STAND_INS: Record<string, string> = {
  "claude-sonnet-5-5": "gpt-6.1-sol",
  "claude-haiku-5-5": "gpt-6-luna",
};

/** The OpenAI model for a Claude model; another Haiku gets Luna, the rest Sol. */
export function openAiModel(claudeModel: string): string {
  return (
    OPENAI_STAND_INS[claudeModel] ??
    (/haiku/i.test(claudeModel) ? "gpt-6-luna" : "gpt-6.1-sol")
  );
}

const usdPerMillion = z.number().nonnegative();

const tokenPricesSchema = z.object({
  input: usdPerMillion,
  output: usdPerMillion,
  cacheWrite5m: usdPerMillion,
  cacheWrite1h: usdPerMillion,
  cacheRead: usdPerMillion,
});

export const modelPriceSchema = tokenPricesSchema.extend({
  /** Higher prices for a request whose prompt is longer than `aboveTokens`. */
  longContext: tokenPricesSchema
    .extend({ aboveTokens: z.number().int().positive() })
    .optional(),
});

export const priceTableSchema = z.object({
  /** USD per million tokens, by model id. */
  models: z.record(z.string(), modelPriceSchema),
  /** USD per 1,000 web searches. */
  webSearchPer1k: z.number().nonnegative(),
});

export type ModelPrice = z.infer<typeof modelPriceSchema>;
export type PriceTable = z.infer<typeof priceTableSchema>;

/**
 * Prices from platform.claude.com/docs/en/about-claude/pricing, read on
 * 17 October 2026, and for OpenAI's models from
 * developers.openai.com/api/docs/pricing and their model pages, read on
 * 31 October 2026: a cache write costs 1.25x input for OpenAI's default
 * 30-minute cache, and a prompt over 272K tokens pays 2x input and cache
 * rates and 1.5x output. The settings row's `prices` column can override
 * them as prices change.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  models: {
    "claude-sonnet-5-5": {
      input: 2,
      output: 10,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.1,
    },
    "claude-haiku-5-5": {
      input: 0.1,
      output: 0.5,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.2,
      cacheRead: 0.01,
      longContext: {
        aboveTokens: 100_000,
        input: 0.5,
        output: 2.5,
        cacheWrite5m: 0.625,
        cacheWrite1h: 1,
        cacheRead: 0.05,
      },
    },
    "gpt-6.1-sol": {
      input: 2,
      output: 10,
      cacheWrite5m: 2.5,
      cacheWrite1h: 5,
      cacheRead: 0.1,
      longContext: {
        aboveTokens: 272_000,
        input: 4,
        output: 15,
        cacheWrite5m: 5,
        cacheWrite1h: 10,
        cacheRead: 0.2,
      },
    },
    "gpt-6-luna": {
      input: 0.1,
      output: 0.5,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.25,
      cacheRead: 0.01,
      longContext: {
        aboveTokens: 272_000,
        input: 0.2,
        output: 0.75,
        cacheWrite5m: 0.25,
        cacheWrite1h: 0.5,
        cacheRead: 0.02,
      },
    },
  },
  /** The same for Claude's and OpenAI's web search: $10 per 1,000. */
  webSearchPer1k: 10,
};

/**
 * Where discovery searches: applicant tracking systems that host company job
 * boards, then remote job boards. Each discover call searches one group of
 * four, with up to 3 searches. One more call searches the rest of the web,
 * leaving these sites and the ones in OFF_LIMITS_JOB_SITES out.
 */
export const DEFAULT_SEARCH_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "recruitee.com",
  "weworkremotely.com",
  "remotive.com",
  "remoteok.com",
  "himalayas.app",
  "workingnomads.com",
  "landing.jobs",
];

/**
 * Job sites the open-web search never returns and the pipeline never reads:
 * their terms forbid scraping, or they block bots. Each entry covers its
 * subdomains, such as uk.indeed.com.
 */
export const OFF_LIMITS_JOB_SITES = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "glassdoor.co.uk",
  "glassdoor.de",
  "ziprecruiter.com",
  "ziprecruiter.co.uk",
  "monster.com",
  "monster.co.uk",
  "monster.de",
  "simplyhired.com",
  "careerbuilder.com",
  "dice.com",
  "wellfound.com",
  "xing.com",
  "stepstone.de",
  "upwork.com",
];

/** How many domains one search call covers. */
export const DOMAINS_PER_SEARCH = 4;

/** Splits the search domains into the groups one discover call each searches. */
export function searchDomainGroups(
  domains: readonly string[],
  size = DOMAINS_PER_SEARCH,
): string[][] {
  const groups: string[][] = [];
  for (let start = 0; start < domains.length; start += size) {
    groups.push(domains.slice(start, start + size));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// What runs the agent steps
// ---------------------------------------------------------------------------

/**
 * What the agent steps run on: the Claude API with the app's key, a
 * command-line agent signed in to one of the owner's plans, or the OpenAI
 * API with the owner's key. Matches the `agent_engine` enum.
 */
export const AGENT_ENGINES = [
  "claude_api",
  "claude_code",
  "codex",
  "openai_api",
] as const;

export type AgentEngine = (typeof AGENT_ENGINES)[number];

/**
 * The order Settings and setup offer the engines in: a plan's command-line
 * agent first, the APIs, paid per call, after.
 */
export const ENGINE_CHOICE_ORDER = [
  "claude_code",
  "codex",
  "claude_api",
  "openai_api",
] as const satisfies readonly AgentEngine[];

export function isAgentEngine(value: string): value is AgentEngine {
  return (AGENT_ENGINES as readonly string[]).includes(value);
}

/**
 * An engine a step tries before the Claude API. A step it can't answer runs
 * on the Claude API.
 */
export type OtherEngine = Exclude<AgentEngine, "claude_api">;

/**
 * The engines that run a command-line agent in a sandbox, on the owner's
 * plan, so their steps cost nothing against the budget.
 */
export type CliEngine = Exclude<OtherEngine, "openai_api">;

export const ENGINE_NAMES: Record<AgentEngine, string> = {
  claude_api: "Claude API",
  claude_code: "Claude Code",
  codex: "Codex",
  openai_api: "OpenAI API",
};

export function isOtherEngine(engine: AgentEngine): engine is OtherEngine {
  return engine !== "claude_api";
}

export function isCliEngine(engine: AgentEngine): engine is CliEngine {
  return engine === "claude_code" || engine === "codex";
}

// ---------------------------------------------------------------------------
// The Settings form
// ---------------------------------------------------------------------------

/** When Postgres doesn't know a time zone the browser offered. */
export const UNKNOWN_TIME_ZONE =
  "The app's database doesn't know this time zone. Pick a city near you with the same time.";

/** An IANA time zone name such as Europe/Lisbon, without spaces around it. */
export const timeZoneSchema = z
  .string({ error: "Pick your time zone." })
  .trim()
  .refine((value) => timeZoneName(value) !== null, {
    error: "Pick a time zone from the list.",
  });

/**
 * What the Settings page saves. A budget of 0 stops every paid API call, to
 * Claude or OpenAI; steps on a plan's command-line agent still run. The time
 * zone sets when the morning runs start and when the owner's day turns over.
 */
export const settingsInputSchema = z.object({
  dailyRunEnabled: z.boolean(),
  monthlyBudgetUsd: z
    .number({ error: "Enter an amount in US dollars." })
    .min(0, "Use 0 or more.")
    .max(1000, "Use at most $1000."),
  agentEngine: z.enum(AGENT_ENGINES, { error: "Pick what the agents run on." }),
  timeZone: timeZoneSchema,
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** The part of Settings kept in the `settings` row. */
export type SettingsRowInput = Omit<SettingsInput, "timeZone">;

/**
 * Codex's sign-in file, `~/.codex/auth.json`, as the owner pastes it. Codex
 * renews the tokens in it, and the app keeps the renewed file.
 */
export const codexLoginInputSchema = z.object({
  authJson: z
    .string()
    .trim()
    .min(1, { error: "Paste the contents of auth.json.", abort: true })
    .max(20_000, {
      error: "That's longer than a Codex sign-in file.",
      abort: true,
    })
    .refine(isCodexAuthJson, {
      message:
        "That isn't Codex's auth.json. Run codex login, then paste the whole file.",
    }),
});

export type CodexLoginInput = z.infer<typeof codexLoginInputSchema>;

/** Whether text is a Codex auth.json with a ChatGPT sign-in or an API key. */
export function isCodexAuthJson(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const file = parsed as {
    tokens?: { refresh_token?: unknown } | null;
    OPENAI_API_KEY?: unknown;
  };
  return (
    typeof file.tokens?.refresh_token === "string" ||
    (typeof file.OPENAI_API_KEY === "string" && file.OPENAI_API_KEY !== "")
  );
}

/**
 * An OpenAI API key, as the owner pastes it from OpenAI's dashboard: `sk-`
 * then letters, digits, `-` and `_`, such as a project key, `sk-proj-…`.
 */
export const openAiKeyInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, { error: "Paste your OpenAI API key.", abort: true })
    .max(500, { error: "That's longer than an OpenAI API key.", abort: true })
    .regex(/^sk-[\w-]{20,}$/, {
      error:
        "That doesn't look like an OpenAI API key, which starts with sk-. Check you copied all of it.",
    }),
});

export type OpenAiKeyInput = z.infer<typeof openAiKeyInputSchema>;

/**
 * A Claude API key, as the owner pastes it from the Claude Console:
 * `sk-ant-` then letters, digits, `-` and `_`.
 */
export const claudeApiKeyInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, { error: "Paste your Claude API key.", abort: true })
    .max(500, { error: "That's longer than a Claude API key.", abort: true })
    .regex(/^sk-ant-[\w-]{20,}$/, {
      error:
        "That doesn't look like a Claude API key, which starts with sk-ant-. Check you copied all of it.",
    }),
});

export type ClaudeApiKeyInput = z.infer<typeof claudeApiKeyInputSchema>;
