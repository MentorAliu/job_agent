CREATE TYPE "document_kind" AS ENUM('cv', 'cover_letter', 'answers');--> statement-breakpoint
CREATE TYPE "eligibility" AS ENUM('eligible', 'not_eligible', 'unclear');--> statement-breakpoint
CREATE TYPE "file_kind" AS ENUM('cv_upload', 'document_pdf');--> statement-breakpoint
CREATE TYPE "job_status" AS ENUM('new', 'shortlisted', 'ready', 'applied', 'interviewing', 'offer', 'rejected', 'no_response', 'withdrawn', 'skipped', 'not_eligible');--> statement-breakpoint
CREATE TYPE "llm_stage" AS ENUM('parse_cv', 'discover', 'extract', 'score', 'company_snapshot', 'tailor', 'claim_check');--> statement-breakpoint
CREATE TYPE "run_status" AS ENUM('running', 'succeeded', 'failed', 'stopped');--> statement-breakpoint
CREATE TYPE "run_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL UNIQUE,
	"applied_at" timestamp with time zone NOT NULL,
	"cv_document_id" uuid,
	"letter_document_id" uuid,
	"answers_document_id" uuid,
	"follow_up_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"claim_flags" jsonb,
	"pdf_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" "file_kind" NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"anthropic_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"canonical_url" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"apply_url" text,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"description_md" text,
	"facts" jsonb,
	"eligibility" "eligibility",
	"eligibility_quote" text,
	"score" integer,
	"score_reasons" jsonb,
	"status" "job_status" DEFAULT 'new'::"job_status" NOT NULL,
	"first_run_id" uuid,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_score_range" CHECK ("score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid,
	"job_id" uuid,
	"stage" "llm_stage" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12,6) NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"data" jsonb NOT NULL,
	"preferences" jsonb,
	"answers" jsonb,
	"cv_file_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "profile_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"profile_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'running'::"run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"cost_usd" numeric(12,6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"monthly_budget_usd" numeric(12,6) DEFAULT '20' NOT NULL,
	"run_budget_usd" numeric(12,6) DEFAULT '1' NOT NULL,
	"models" jsonb,
	"prices" jsonb,
	"daily_run_enabled" boolean DEFAULT true NOT NULL,
	"search_domains" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_job_kind_version_idx" ON "document" ("job_id","kind","version");--> statement-breakpoint
CREATE INDEX "event_job_at_idx" ON "event" ("job_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_key_idx" ON "job" ("dedupe_key");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "job" ("status");--> statement-breakpoint
CREATE INDEX "job_score_idx" ON "job" ("score");--> statement-breakpoint
CREATE INDEX "llm_call_created_at_idx" ON "llm_call" ("created_at");--> statement-breakpoint
CREATE INDEX "llm_call_run_id_idx" ON "llm_call" ("run_id");--> statement-breakpoint
CREATE INDEX "run_started_at_idx" ON "run" ("started_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_cv_document_id_document_id_fkey" FOREIGN KEY ("cv_document_id") REFERENCES "document"("id");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_letter_document_id_document_id_fkey" FOREIGN KEY ("letter_document_id") REFERENCES "document"("id");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_answers_document_id_document_id_fkey" FOREIGN KEY ("answers_document_id") REFERENCES "document"("id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_snapshot_id_profile_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "profile_snapshot"("id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_pdf_file_id_file_id_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "file"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_first_run_id_run_id_fkey" FOREIGN KEY ("first_run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_cv_file_id_file_id_fkey" FOREIGN KEY ("cv_file_id") REFERENCES "file"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;