// The nineteen app tables. Better Auth's tables are generated into db/auth-schema.ts.
// JSON columns are typed with `.$type<…>()` from lib/schemas/ as each phase
// defines its schema.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ADDED_ROLE_STATUSES } from "../lib/schemas/added-role";
import {
  BUILT_CV_STATUSES,
  type CvBuildRequest,
} from "../lib/schemas/cv-builder";
import {
  ROLE_FOCUS,
  type JobFacts,
  type RunStats,
  type ScoreReasons,
} from "../lib/schemas/job";
import {
  EMAIL_AUTHORS,
  EMAIL_READ_STATUSES,
  MAIL_OUTCOMES,
  type SuggestedReply,
} from "../lib/schemas/mail";
import type {
  Answers,
  HeaderLink,
  MasterProfile,
  Preferences,
} from "../lib/schemas/profile";
import {
  AGENT_ENGINES,
  type PriceTable,
  type StageModels,
} from "../lib/schemas/settings";
import { ENGINE_CHECK_STATUSES, SETUP_CV_PATHS } from "../lib/schemas/setup";
import {
  DOCUMENT_KINDS,
  type ClaimCheck,
  type CompanyBrief,
  type CvContent,
  type DocumentContent,
  type TailorState,
} from "../lib/schemas/tailor";
import { JOB_STATUSES, type JobEvent } from "../lib/schemas/tracker";
import type { FeedId } from "../lib/jobs/feed-boards";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const usd = (name: string) =>
  numeric(name, { precision: 12, scale: 6, mode: "number" });

export const jobStatus = pgEnum("job_status", JOB_STATUSES);
export const eligibility = pgEnum("eligibility", [
  "eligible",
  "not_eligible",
  "unclear",
]);
export const roleFocus = pgEnum("role_focus", ROLE_FOCUS);
export const documentKind = pgEnum("document_kind", DOCUMENT_KINDS);
export const runTrigger = pgEnum("run_trigger", ["scheduled", "manual"]);
export const runStatus = pgEnum("run_status", [
  "running",
  "succeeded",
  "failed",
  "stopped",
]);
export const llmStage = pgEnum("llm_stage", [
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
]);
export const agentEngine = pgEnum("agent_engine", AGENT_ENGINES);
export const engineCheckStatus = pgEnum(
  "engine_check_status",
  ENGINE_CHECK_STATUSES,
);
export const setupCvPath = pgEnum("setup_cv_path", SETUP_CV_PATHS);
export const mailOutcome = pgEnum("mail_outcome", MAIL_OUTCOMES);
export const emailAuthor = pgEnum("email_author", EMAIL_AUTHORS);
export const emailReadStatus = pgEnum("email_read_status", EMAIL_READ_STATUSES);
export const builtCvStatus = pgEnum("built_cv_status", BUILT_CV_STATUSES);
export const addedRoleStatus = pgEnum("added_role_status", ADDED_ROLE_STATUSES);
export const fileKind = pgEnum("file_kind", ["cv_upload", "document_pdf"]);
export const cvParseStatus = pgEnum("cv_parse_status", [
  "pending",
  "succeeded",
  "failed",
]);

/** Uploaded and generated files. The bytes live in lib/storage. */
export const file = pgTable("file", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: fileKind("kind").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  /** The name of the file on the owner's computer, for display. */
  originalName: text("original_name"),
  anthropicFileId: text("anthropic_file_id"),
  // CV uploads only: step 1 of the pipeline reads the CV into a draft profile
  // that the owner reviews before saving it to `profile`.
  parseStatus: cvParseStatus("parse_status"),
  parsedProfile: jsonb("parsed_profile").$type<MasterProfile>(),
  parseError: text("parse_error"),
  /** Set when the owner keeps the saved profile instead of this draft. */
  draftDismissedAt: timestamp("draft_dismissed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * The owner's current master profile. One row, id 1. `data` stays null until
 * the profile is first saved, since preferences and answers can come first.
 */
export const profile = pgTable(
  "profile",
  {
    id: integer("id").primaryKey().default(1),
    data: jsonb("data").$type<MasterProfile>(),
    preferences: jsonb("preferences").$type<Preferences>(),
    answers: jsonb("answers").$type<Answers>(),
    cvFileId: uuid("cv_file_id").references(() => file.id, {
      onDelete: "set null",
    }),
    updatedAt: updatedAt(),
  },
  (t) => [check("profile_single_row", sql`${t.id} = 1`)],
);

/** A frozen copy of the profile, saved each time it changes. */
export const profileSnapshot = pgTable("profile_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileData: jsonb("profile_data").$type<MasterProfile>().notNull(),
  createdAt: createdAt(),
});

/** One search run. */
export const run = pgTable(
  "run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: runTrigger("trigger").notNull(),
    status: runStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").$type<RunStats>(),
    costUsd: usd("cost_usd").notNull().default(0),
  },
  (t) => [index("run_started_at_idx").on(t.startedAt)],
);

/** One posting, merged across runs by `dedupe_key`. */
export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalUrl: text("canonical_url").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    applyUrl: text("apply_url"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md"),
    facts: jsonb("facts").$type<JobFacts>(),
    /** Company, title and allowed places, normalized: the same posting at another link. */
    contentKey: text("content_key"),
    eligibility: eligibility("eligibility"),
    eligibilityQuote: text("eligibility_quote"),
    eligibilityReasons: jsonb("eligibility_reasons").$type<string[]>(),
    score: integer("score"),
    scoreReasons: jsonb("score_reasons").$type<ScoreReasons>(),
    /** What the role mainly works on, as the score read it. */
    focus: roleFocus("focus"),
    /**
     * The day the employer posted it: from its applicant tracking system, else
     * the page's own data, else what the page says.
     */
    postedOn: date("posted_on"),
    status: jobStatus("status").notNull().default("new"),
    /** The owner's own notes on the role. */
    notes: text("notes"),
    /** When to follow up next. The tracker reminds the owner from this day on. */
    followUpOn: date("follow_up_on"),
    /** Step 7: a short brief on the company, from a web search. */
    companyBrief: jsonb("company_brief").$type<CompanyBrief>(),
    /** The latest tailoring request and how far it got (steps 7–10). */
    tailoring: jsonb("tailoring").$type<TailorState>(),
    firstRunId: uuid("first_run_id").references(() => run.id, {
      onDelete: "set null",
    }),
    /** The owner added it by hand, from a link or a posting's text. */
    addedByOwner: boolean("added_by_owner").notNull().default(false),
    foundAt: timestamp("found_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("job_dedupe_key_idx").on(t.dedupeKey),
    index("job_content_key_idx").on(t.contentKey),
    index("job_first_run_id_idx").on(t.firstRunId),
    index("job_status_idx").on(t.status),
    index("job_score_idx").on(t.score),
    index("job_found_at_idx").on(t.foundAt),
    index("job_posted_on_idx").on(t.postedOn),
    index("job_follow_up_on_idx").on(t.followUpOn),
    check("job_score_range", sql`${t.score} between 0 and 100`),
  ],
);

/**
 * A link a run read but didn't store: a page that isn't a posting, a page
 * that couldn't be read, or a posting already stored at another link. Later
 * runs don't read it again, except once for a read that may pass next time.
 */
export const seenLink = pgTable("seen_link", {
  dedupeKey: text("dedupe_key").primaryKey(),
  url: text("url").notNull(),
  reason: text("reason").notNull(),
  /** The read failed in a way that may pass next time, such as a timeout. */
  tryAgain: boolean("try_again").notNull().default(false),
  firstRunId: uuid("first_run_id").references(() => run.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

/**
 * A posting from a remote job board's own feed that a search may read: the
 * board's text for it is kept here, so it never passes through Inngest's
 * step history. Each read of a feed replaces that feed's rows.
 */
export const feedPosting = pgTable(
  "feed_posting",
  {
    dedupeKey: text("dedupe_key").primaryKey(),
    feed: text("feed").$type<FeedId>().notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    /** Where to apply, as the board's terms ask. */
    applyUrl: text("apply_url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    places: jsonb("places").$type<string[]>().notNull(),
    postedOn: date("posted_on"),
    /** The board's facts and description, for Claude to read. */
    text: text("text").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("feed_posting_feed_idx").on(t.feed)],
);

/** When each board's feed was last asked for, so none is asked twice in an hour. */
export const feedCheck = pgTable("feed_check", {
  feed: text("feed").$type<FeedId>().primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  /** The feed answered, so its rows in `feed_posting` are current. */
  ok: boolean("ok").notNull(),
});

/**
 * A role the owner added by hand: the link and any text they pasted, until
 * an Inngest step reads it, and then what came of it.
 */
export const addedRole = pgTable(
  "added_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    /** The posting's text as pasted. Empty when only the link was given. */
    text: text("text").notNull().default(""),
    status: addedRoleStatus("status").notNull().default("reading"),
    /** What came of it, or why it failed, in words the page shows. */
    note: text("note"),
    jobId: uuid("job_id").references(() => job.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("added_role_created_at_idx").on(t.createdAt)],
);

/** A tailored CV, cover letter or set of answers. */
export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    version: integer("version").notNull().default(1),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => profileSnapshot.id),
    content: jsonb("content").$type<DocumentContent>().notNull(),
    claimFlags: jsonb("claim_flags").$type<ClaimCheck>(),
    pdfFileId: uuid("pdf_file_id").references(() => file.id, {
      onDelete: "set null",
    }),
    /** The tailoring request that wrote it, so a retried step doesn't write it twice. */
    requestId: uuid("request_id"),
    /** The owner's note when this version was regenerated. */
    note: text("note"),
    /** The owner made this version by editing the CV on the CVs page. */
    edited: boolean("edited").notNull().default(false),
    /** The links drawn at the top of its PDF. Null before they were kept, when the profile's were drawn. */
    headerLinks: jsonb("header_links").$type<HeaderLink[]>(),
    /** Set once the claims are checked and the PDF is rendered. Until then the apply kit shows the previous version. */
    readyAt: timestamp("ready_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_job_kind_version_idx").on(t.jobId, t.kind, t.version),
    uniqueIndex("document_request_kind_idx").on(t.requestId, t.kind),
  ],
);

/**
 * A CV made with the CV builder, from the profile as it was then. Claude
 * writes it, the claims are checked as for a tailored CV, and the PDF is
 * drawn with the same template. A CV the owner edits line by line is saved
 * here too, written and checked already, so only its PDF is drawn.
 */
export const builtCv = pgTable(
  "built_cv",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What the owner asked for in the builder's form. */
    request: jsonb("request").$type<CvBuildRequest>().notNull(),
    /** The owner made it by editing a CV, line by line, rather than Claude. */
    edited: boolean("edited").notNull().default(false),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => profileSnapshot.id),
    status: builtCvStatus("status").notNull().default("writing"),
    /** Why it failed, in words the page shows. */
    error: text("error"),
    /** Null until Claude has written it. Bullets left out to fit the length are gone from it. */
    content: jsonb("content").$type<CvContent>(),
    /** What the pasted posting asks for, in its own words. Empty without one. */
    keywords: jsonb("keywords").$type<string[]>(),
    claimFlags: jsonb("claim_flags").$type<ClaimCheck>(),
    pdfFileId: uuid("pdf_file_id").references(() => file.id, {
      onDelete: "set null",
    }),
    pageCount: integer("page_count"),
    /** Bullets left out so the CV fits the length asked for. */
    trimmed: integer("trimmed").notNull().default(0),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("built_cv_created_at_idx").on(t.createdAt)],
);

/**
 * What the owner actually sent for a role. The next follow-up lives on `job`,
 * so the tracker can remind the owner about any role, applied or not.
 */
export const application = pgTable("application", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => job.id, { onDelete: "cascade" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
  cvDocumentId: uuid("cv_document_id").references(() => document.id),
  letterDocumentId: uuid("letter_document_id").references(() => document.id),
  answersDocumentId: uuid("answers_document_id").references(() => document.id),
  createdAt: createdAt(),
});

/** The timeline for each role. `payload` is checked by `jobEventSchema`. */
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<JobEvent["payload"]>(),
    // clock_timestamp(), not now(): events written in one transaction keep
    // their order on the timeline.
    at: timestamp("at", { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (t) => [index("event_job_at_idx").on(t.jobId, t.at)],
);

/**
 * Every agent request, for cost tracking and the budget caps. A request made
 * through a plan's command-line agent costs nothing against the budget.
 */
export const llmCall = pgTable(
  "llm_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => run.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => job.id, { onDelete: "set null" }),
    stage: llmStage("stage").notNull(),
    /** What made the request: the Claude API, or a plan's command-line agent. */
    engine: agentEngine("engine").notNull().default("claude_api"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens")
      .notNull()
      .default(0),
    webSearches: integer("web_searches").notNull().default(0),
    costUsd: usd("cost_usd").notNull(),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_call_created_at_idx").on(t.createdAt),
    index("llm_call_run_id_idx").on(t.runId),
  ],
);

/** App settings. One row, id 1. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    monthlyBudgetUsd: usd("monthly_budget_usd").notNull().default(20),
    runBudgetUsd: usd("run_budget_usd").notNull().default(1),
    models: jsonb("models").$type<StageModels>(),
    prices: jsonb("prices").$type<PriceTable>(),
    dailyRunEnabled: boolean("daily_run_enabled").notNull().default(true),
    searchDomains: jsonb("search_domains").$type<string[]>(),
    /** What the agent steps run on. */
    agentEngine: agentEngine("agent_engine").notNull().default("claude_api"),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

/**
 * One row per engine: its sign-in when the app keeps one, and how its last
 * step went, for Settings. The Claude API's row only holds a pasted key.
 */
export const engineState = pgTable("engine_state", {
  engine: agentEngine("engine").primaryKey(),
  /**
   * Codex's auth.json, which Codex renews, or the Claude or OpenAI API key,
   * encrypted with the app's secret.
   */
  login: text("login"),
  loginSavedAt: timestamp("login_saved_at", { withTimezone: true }),
  /**
   * The step using the sign-in now, and until when: one sandbox at a time
   * uses Codex's auth.json, since two renewing it at once sign both out.
   */
  leaseId: text("lease_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  /** Why the last step that couldn't run on this engine fell back. */
  issue: text("issue"),
  issueAt: timestamp("issue_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/**
 * One "Check it works": a tiny real call on one engine, made the way the
 * agents make theirs, with no fallback to another engine. Setup needs a
 * passed check on the engine it picks; Settings shows the last one.
 */
export const engineCheck = pgTable(
  "engine_check",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engine: agentEngine("engine").notNull(),
    status: engineCheckStatus("status").notNull().default("queued"),
    /** Why it failed (lib/schemas/setup.ts), which decides the advice shown. */
    failure: text("failure"),
    /** What went wrong, in plain words. */
    message: text("message"),
    /** The model that answered. */
    model: text("model"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("engine_check_engine_created_idx").on(t.engine, t.createdAt)],
);

/**
 * First-run setup, one row: how the owner gave their CV and when they
 * confirmed it, the ATS-friendly CV setup made, when setup finished, and the
 * owner's time zone, which setup takes from the browser. The rest lives
 * where the app keeps it anyway: the engine in `settings`, its check in
 * `engine_check`, the profile and preferences in `profile`.
 */
export const setup = pgTable(
  "setup",
  {
    id: integer("id").primaryKey().default(1),
    cvPath: setupCvPath("cv_path"),
    cvConfirmedAt: timestamp("cv_confirmed_at", { withTimezone: true }),
    atsCvId: uuid("ats_cv_id").references(() => builtCv.id, {
      onDelete: "set null",
    }),
    /** Setup is finished: the app opens. Never unset once set. */
    doneAt: timestamp("done_at", { withTimezone: true }),
    /**
     * The owner's time zone, an IANA name such as Europe/Lisbon. Setup saves
     * the browser's when it finishes, and Settings changes it. The morning
     * runs start by it, and the owner's day turns over by it. UTC while unset.
     */
    timeZone: text("time_zone"),
    updatedAt: updatedAt(),
  },
  (t) => [check("setup_single_row", sql`${t.id} = 1`)],
);

/**
 * An email the owner pasted: from a company about an application, or a reply
 * the owner sent. Claude reads it once, in an Inngest step, and what it found
 * is kept beside the text: the outcome, a summary and a suggested reply.
 */
export const jobEmail = pgTable(
  "job_email",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null while the app looks for the role, and when it couldn't tell. */
    jobId: uuid("job_id").references(() => job.id, { onDelete: "cascade" }),
    /** The text as pasted. */
    body: text("body").notNull(),
    /** Pasted on the Applications page, so the app picked the role. */
    autoFiled: boolean("auto_filed").notNull().default(false),
    status: emailReadStatus("status").notNull().default("reading"),
    /** Why reading failed, in words the page shows. */
    error: text("error"),
    author: emailAuthor("author"),
    outcome: mailOutcome("outcome"),
    /** False when Claude wasn't sure, so the status was left alone. */
    sure: boolean("sure"),
    /** The sentence that shows the outcome, as the email words it. */
    quote: text("quote"),
    senderName: text("sender_name"),
    subject: text("subject"),
    summary: text("summary"),
    keyPoints: jsonb("key_points").$type<string[]>(),
    replyNeeded: boolean("reply_needed").notNull().default(false),
    reply: jsonb("reply").$type<SuggestedReply>(),
    /** When the owner copied the reply, or said they'd dealt with it. */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    /** When it was last sent to be read: pasted, or tried again. */
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_email_job_id_idx").on(t.jobId, t.createdAt),
    index("job_email_created_at_idx").on(t.createdAt),
  ],
);
