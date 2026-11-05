CREATE TABLE "seen_link" (
	"dedupe_key" text PRIMARY KEY,
	"url" text NOT NULL,
	"reason" text NOT NULL,
	"first_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "content_key" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "eligibility_reasons" jsonb;--> statement-breakpoint
CREATE INDEX "job_content_key_idx" ON "job" ("content_key");--> statement-breakpoint
CREATE INDEX "job_first_run_id_idx" ON "job" ("first_run_id");--> statement-breakpoint
ALTER TABLE "seen_link" ADD CONSTRAINT "seen_link_first_run_id_run_id_fkey" FOREIGN KEY ("first_run_id") REFERENCES "run"("id") ON DELETE SET NULL;