DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'story_publication_import_jobs'::regclass
      AND conname = 'story_publication_import_jobs_anchor'
  ) THEN
    IF EXISTS (SELECT 1 FROM story_publication_import_jobs LIMIT 1)
      OR EXISTS (SELECT 1 FROM story_publication_source_chunks LIMIT 1) THEN
      RAISE EXCEPTION 'Publication import anchor or source chunks contain unexpected rows';
    END IF;
    ALTER TABLE story_publication_source_chunks
      DROP CONSTRAINT story_publication_source_chunks_job_fkey;
    DROP TABLE story_publication_import_jobs;
  END IF;
END $$;
