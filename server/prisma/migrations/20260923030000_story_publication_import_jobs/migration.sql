CREATE TABLE "story_publication_import_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "story_key" VARCHAR(24) NOT NULL,
  "source_binding_sha256" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "plan_snapshot" JSONB,
  "batch_cursor" INTEGER NOT NULL DEFAULT 0,
  "work_id" UUID,
  "release_id" UUID,
  "error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_publication_import_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_publication_import_jobs_status" CHECK (
    "status" IN ('queued', 'structuring', 'materializing', 'finalizing', 'published', 'failed')
  ),
  CONSTRAINT "story_publication_import_jobs_story_key" CHECK (
    "story_key" IN ('imjin', 'norse')
  ),
  CONSTRAINT "story_publication_import_jobs_source_hash" CHECK (
    "source_binding_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "story_publication_import_jobs_cursor" CHECK ("batch_cursor" >= 0),
  CONSTRAINT "story_publication_import_jobs_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "story_publication_import_jobs_work_fkey"
    FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE RESTRICT,
  CONSTRAINT "story_publication_import_jobs_release_fkey"
    FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "story_publication_import_jobs_identity"
  ON "story_publication_import_jobs" ("actor_user_id", "story_key", "source_binding_sha256");
CREATE INDEX "idx_story_publication_import_jobs_actor_status"
  ON "story_publication_import_jobs" ("actor_user_id", "status", "updated_at");
