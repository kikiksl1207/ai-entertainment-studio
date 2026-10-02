ALTER TABLE "story_publication_choice_batches"
  DROP CONSTRAINT "story_publication_choice_batches_status_check";

ALTER TABLE "story_publication_choice_batches"
  ADD CONSTRAINT "story_publication_choice_batches_status_check"
  CHECK ("status" IN ('in_progress', 'review_required', 'retry_authorized', 'completed'));

DROP INDEX "story_publication_choice_batches_active_work";

CREATE UNIQUE INDEX "story_publication_choice_batches_active_work"
  ON "story_publication_choice_batches" ("work_id", "release_id")
  WHERE "status" IN ('in_progress', 'review_required', 'retry_authorized');
