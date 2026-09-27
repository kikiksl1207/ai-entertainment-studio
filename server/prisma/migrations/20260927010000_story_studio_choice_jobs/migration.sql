CREATE TABLE "story_studio_choice_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "total_parts" INTEGER NOT NULL,
  "completed_parts" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_studio_choice_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_studio_choice_jobs_progress_check" CHECK (
    "total_parts" > 0 AND "completed_parts" >= 0 AND "completed_parts" <= "total_parts"
  ),
  CONSTRAINT "story_studio_choice_jobs_status_check" CHECK (
    "status" IN ('queued', 'processing', 'failed', 'completed')
  )
);

CREATE UNIQUE INDEX "story_studio_choice_jobs_release_id_key" ON "story_studio_choice_jobs"("release_id");
CREATE INDEX "idx_story_studio_choice_jobs_claim" ON "story_studio_choice_jobs"("status", "lease_expires_at", "created_at");
