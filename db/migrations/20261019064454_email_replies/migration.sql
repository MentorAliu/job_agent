CREATE TYPE "mail_account_status" AS ENUM('connected', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "mail_outcome" AS ENUM('received', 'rejected', 'interview', 'assessment', 'offer', 'other', 'unrelated');--> statement-breakpoint
ALTER TYPE "llm_stage" ADD VALUE 'read_email';--> statement-breakpoint
CREATE TABLE "mail_account" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"address" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"status" "mail_account_status" DEFAULT 'connected'::"mail_account_status" NOT NULL,
	"last_error" text,
	"read_after" timestamp with time zone NOT NULL,
	"read_from" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_account_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "mail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"graph_id" text NOT NULL,
	"job_id" uuid,
	"outcome" "mail_outcome" NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_graph_id_idx" ON "mail_message" ("graph_id");--> statement-breakpoint
CREATE INDEX "mail_message_job_id_idx" ON "mail_message" ("job_id");--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE;