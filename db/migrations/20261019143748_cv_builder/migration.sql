CREATE TYPE "built_cv_status" AS ENUM('writing', 'checking', 'rendering', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "llm_stage" ADD VALUE 'build_cv';--> statement-breakpoint
CREATE TABLE "built_cv" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request" jsonb NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"status" "built_cv_status" DEFAULT 'writing'::"built_cv_status" NOT NULL,
	"error" text,
	"content" jsonb,
	"keywords" jsonb,
	"claim_flags" jsonb,
	"pdf_file_id" uuid,
	"page_count" integer,
	"trimmed" integer DEFAULT 0 NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "built_cv_created_at_idx" ON "built_cv" ("created_at");--> statement-breakpoint
ALTER TABLE "built_cv" ADD CONSTRAINT "built_cv_snapshot_id_profile_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "profile_snapshot"("id");--> statement-breakpoint
ALTER TABLE "built_cv" ADD CONSTRAINT "built_cv_pdf_file_id_file_id_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "file"("id") ON DELETE SET NULL;