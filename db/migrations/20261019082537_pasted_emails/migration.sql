CREATE TYPE "email_author" AS ENUM('employer', 'candidate');--> statement-breakpoint
CREATE TYPE "email_read_status" AS ENUM('reading', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "job_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid,
	"body" text NOT NULL,
	"auto_filed" boolean DEFAULT false NOT NULL,
	"status" "email_read_status" DEFAULT 'reading'::"email_read_status" NOT NULL,
	"error" text,
	"author" "email_author",
	"outcome" "mail_outcome",
	"sure" boolean,
	"quote" text,
	"sender_name" text,
	"subject" text,
	"summary" text,
	"key_points" jsonb,
	"reply_needed" boolean DEFAULT false NOT NULL,
	"reply" jsonb,
	"handled_at" timestamp with time zone,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "mail_account";--> statement-breakpoint
DROP TABLE "mail_message";--> statement-breakpoint
CREATE INDEX "job_email_job_id_idx" ON "job_email" ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "job_email_created_at_idx" ON "job_email" ("created_at");--> statement-breakpoint
ALTER TABLE "job_email" ADD CONSTRAINT "job_email_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "mail_account_status";