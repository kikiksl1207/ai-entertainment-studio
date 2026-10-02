CREATE UNIQUE INDEX "story_publication_choice_batches_active_work"
  ON "story_publication_choice_batches" ("work_id", "release_id")
  WHERE "status" IN ('in_progress', 'review_required');
