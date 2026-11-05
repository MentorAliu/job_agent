CREATE TYPE "cv_parse_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "parse_status" "cv_parse_status";--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "parsed_profile" jsonb;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "parse_error" text;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "draft_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "data" DROP NOT NULL;