-- Frontend roles in any framework now count as strong (lib/claude/score.ts),
-- so roles the app passed over for their score in the last three weeks go
-- back to New, and the next search scores them again. Roles the owner sorted
-- by hand, and roles the app picked, are left as they are.
WITH "latest" AS (
	SELECT DISTINCT ON ("job_id") "job_id", "payload"
	FROM "event"
	WHERE "type" = 'status_changed'
	ORDER BY "job_id", "at" DESC
), "rescored" AS (
	UPDATE "job"
	SET "status" = 'new', "score" = NULL, "score_reasons" = NULL, "focus" = NULL, "updated_at" = now()
	FROM "latest"
	WHERE "latest"."job_id" = "job"."id"
		AND "job"."status" = 'skipped'
		AND "latest"."payload"->>'to' = 'skipped'
		AND "latest"."payload"->>'reason' LIKE 'Passed over automatically: it scored %'
		AND "job"."found_at" > now() - interval '21 days'
	RETURNING "job"."id"
)
INSERT INTO "event" ("job_id", "type", "payload")
SELECT "id", 'status_changed', jsonb_build_object(
	'from', 'skipped',
	'to', 'new',
	'reason', 'Back to New to be scored again: frontend roles in any framework now count as strong.'
)
FROM "rescored";
