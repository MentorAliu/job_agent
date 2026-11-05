-- Job preferences now say which kind of role comes first (roleFocus in
-- lib/schemas/profile.ts). Before, frontend roles always did, so a copy that
-- already saved its preferences keeps that. A new copy starts with "any".
UPDATE "profile"
SET "preferences" = "preferences" || '{"roleFocus": "frontend"}'::jsonb
WHERE "preferences" IS NOT NULL
	AND jsonb_typeof("preferences") = 'object'
	AND NOT ("preferences" ? 'roleFocus');
