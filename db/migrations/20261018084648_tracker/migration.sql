ALTER TABLE "job" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "follow_up_on";--> statement-breakpoint
CREATE INDEX "job_found_at_idx" ON "job" ("found_at");--> statement-breakpoint
CREATE INDEX "job_follow_up_on_idx" ON "job" ("follow_up_on");