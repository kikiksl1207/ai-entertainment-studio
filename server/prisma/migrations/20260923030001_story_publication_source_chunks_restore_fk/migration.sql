DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'story_publication_source_chunks'::regclass
      AND conname = 'story_publication_source_chunks_job_fkey'
  ) THEN
    ALTER TABLE story_publication_source_chunks
      ADD CONSTRAINT story_publication_source_chunks_job_fkey
      FOREIGN KEY (job_id) REFERENCES story_publication_import_jobs(id)
      ON DELETE CASCADE;
  END IF;
END $$;
