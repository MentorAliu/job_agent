CREATE TYPE "added_role_status" AS ENUM('reading', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "added_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"url" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" "added_role_status" DEFAULT 'reading'::"added_role_status" NOT NULL,
	"note" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_check" (
	"feed" text PRIMARY KEY,
	"checked_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_posting" (
	"dedupe_key" text PRIMARY KEY,
	"feed" text NOT NULL,
	"canonical_url" text NOT NULL,
	"apply_url" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"places" jsonb NOT NULL,
	"posted_on" date,
	"text" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "added_by_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "added_role_created_at_idx" ON "added_role" ("created_at");--> statement-breakpoint
CREATE INDEX "feed_posting_feed_idx" ON "feed_posting" ("feed");--> statement-breakpoint
ALTER TABLE "added_role" ADD CONSTRAINT "added_role_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE SET NULL;