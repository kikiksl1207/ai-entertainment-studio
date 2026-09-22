CREATE TABLE "story_publication_source_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "total_chunks" INTEGER NOT NULL,
  "payload" BYTEA NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_publication_source_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_publication_source_chunks_position" CHECK ("position" >= 0),
  CONSTRAINT "story_publication_source_chunks_total" CHECK ("total_chunks" BETWEEN 1 AND 64),
  CONSTRAINT "story_publication_source_chunks_checksum" CHECK (
    "checksum_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "story_publication_source_chunks_job_fkey"
    FOREIGN KEY ("job_id") REFERENCES "story_publication_import_jobs"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "story_publication_source_chunks_job_position"
  ON "story_publication_source_chunks" ("job_id", "position");
CREATE INDEX "idx_story_publication_source_chunks_job"
  ON "story_publication_source_chunks" ("job_id");
