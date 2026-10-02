-- The immutable source-chunks migration needs a parent table before the full
-- import-jobs migration is reached on a fresh database.
CREATE TABLE IF NOT EXISTS "story_publication_import_jobs" (
  "id" UUID NOT NULL,
  CONSTRAINT "story_publication_import_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_publication_import_jobs_anchor" CHECK (false)
);
