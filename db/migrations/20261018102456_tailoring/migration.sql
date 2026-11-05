ALTER TABLE "document" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "company_brief" jsonb;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "tailoring" jsonb;--> statement-breakpoint
ALTER TABLE "event" ALTER COLUMN "at" SET DEFAULT clock_timestamp();--> statement-breakpoint
CREATE UNIQUE INDEX "document_request_kind_idx" ON "document" ("request_id","kind");