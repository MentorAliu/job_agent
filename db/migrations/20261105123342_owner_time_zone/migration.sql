ALTER TABLE "setup" ADD COLUMN "time_zone" text;--> statement-breakpoint
-- The owner's time zone used to be fixed in code as Europe/Belgrade, so a
-- copy already set up keeps it, and its morning runs don't move. A new copy
-- gets the browser's time zone when it finishes setup.
UPDATE "setup"
SET "time_zone" = 'Europe/Belgrade'
WHERE "done_at" IS NOT NULL
	AND "time_zone" IS NULL;
