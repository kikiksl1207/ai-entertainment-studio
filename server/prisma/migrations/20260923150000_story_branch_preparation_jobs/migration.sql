CREATE TABLE "story_branch_preparation_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "part_index" INTEGER NOT NULL,
  "expected_part_count" INTEGER NOT NULL,
  "part_key" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'awaiting_author_consent',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_branch_preparation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_branch_preparation_jobs_source_fkey"
    FOREIGN KEY ("manuscript_version_id", "work_id", "owner_user_id")
    REFERENCES "story_manuscript_versions"("id", "work_id", "owner_user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_branch_preparation_jobs_part_index_check" CHECK ("part_index" >= 0 AND "expected_part_count" > 0 AND "part_index" < "expected_part_count"),
  CONSTRAINT "story_branch_preparation_jobs_source_hash_check" CHECK ("source_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "uq_story_branch_preparation_part"
  ON "story_branch_preparation_jobs"("manuscript_version_id", "part_index", "prompt_version");
CREATE INDEX "idx_story_branch_preparation_status"
  ON "story_branch_preparation_jobs"("status", "created_at");
CREATE INDEX "idx_story_branch_preparation_owner"
  ON "story_branch_preparation_jobs"("owner_user_id", "work_id", "manuscript_version_id");
