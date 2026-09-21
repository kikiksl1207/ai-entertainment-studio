ALTER TABLE "story_ai_continuations"
  ADD COLUMN "dispatch_started_at" TIMESTAMPTZ(6);

-- Legacy processing rows may already have made a paid call. Never replay on upgrade.
UPDATE "story_ai_continuations"
SET "dispatch_started_at" = COALESCE("started_at", CURRENT_TIMESTAMP)
WHERE "request_kind" = 'recommended_choice' AND "status" = 'processing';
