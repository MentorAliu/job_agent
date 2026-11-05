CREATE TYPE "engine_check_status" AS ENUM('queued', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "setup_cv_path" AS ENUM('upload', 'form');--> statement-breakpoint
ALTER TYPE "llm_stage" ADD VALUE 'check_engine';--> statement-breakpoint
CREATE TABLE "engine_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"engine" "agent_engine" NOT NULL,
	"status" "engine_check_status" DEFAULT 'queued'::"engine_check_status" NOT NULL,
	"failure" text,
	"message" text,
	"model" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"cv_path" "setup_cv_path",
	"cv_confirmed_at" timestamp with time zone,
	"ats_cv_id" uuid,
	"done_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE INDEX "engine_check_engine_created_idx" ON "engine_check" ("engine","created_at");--> statement-breakpoint
ALTER TABLE "setup" ADD CONSTRAINT "setup_ats_cv_id_built_cv_id_fkey" FOREIGN KEY ("ats_cv_id") REFERENCES "built_cv"("id") ON DELETE SET NULL;