ALTER TABLE "story_publication_import_jobs"
  DROP CONSTRAINT "story_publication_import_jobs_status";

ALTER TABLE "story_publication_import_jobs"
  ADD CONSTRAINT "story_publication_import_jobs_status" CHECK (
    "status" IN ('queued', 'awaiting_author_review', 'structuring', 'materializing', 'finalizing', 'published', 'failed')
  ),
  ADD CONSTRAINT "story_publication_import_jobs_private_binding" CHECK (
    "status" <> 'awaiting_author_review' OR
    ("work_id" IS NOT NULL AND "release_id" IS NULL AND "batch_cursor" = 0 AND "plan_snapshot" IS NOT NULL)
  );
