CREATE TYPE "agent_engine" AS ENUM('claude_api', 'claude_code', 'codex');--> statement-breakpoint
CREATE TABLE "engine_state" (
	"engine" "agent_engine" PRIMARY KEY,
	"login" text,
	"login_saved_at" timestamp with time zone,
	"lease_id" text,
	"lease_until" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"issue" text,
	"issue_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_call" ADD COLUMN "engine" "agent_engine" DEFAULT 'claude_api'::"agent_engine" NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "agent_engine" "agent_engine" DEFAULT 'claude_api'::"agent_engine" NOT NULL;