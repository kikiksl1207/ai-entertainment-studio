ALTER TABLE "story_publication_import_jobs"
  DROP CONSTRAINT "story_publication_import_jobs_story_key";

ALTER TABLE "story_publication_import_jobs"
  ADD CONSTRAINT "story_publication_import_jobs_story_key" CHECK (
    "story_key" IN ('imjin', 'norse', 'monster', 'rebellion')
  );
