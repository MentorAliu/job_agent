CREATE TYPE "role_focus" AS ENUM('frontend', 'fullstack', 'backend', 'mobile', 'other');--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "focus" "role_focus";--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "posted_on" date;--> statement-breakpoint
CREATE INDEX "job_posted_on_idx" ON "job" ("posted_on");