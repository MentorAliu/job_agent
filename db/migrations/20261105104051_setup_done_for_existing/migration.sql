-- First-run setup (app/setup) leads a new copy through choosing and checking
-- its AI provider, its CV and what it's looking for, and only then opens the
-- app. A copy that already has a profile is in use, so it counts as set up and
-- never sees those steps. A new copy has no profile yet and starts at step 1.
INSERT INTO "setup" ("id", "done_at")
SELECT 1, now()
WHERE EXISTS (SELECT 1 FROM "profile" WHERE "data" IS NOT NULL)
ON CONFLICT ("id") DO NOTHING;
