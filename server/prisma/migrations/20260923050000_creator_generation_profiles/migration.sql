CREATE TABLE "story_upload_generation_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "profile_version" INTEGER NOT NULL DEFAULT 1,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending_analysis',
  "draft_settings" JSONB NOT NULL DEFAULT '{}',
  "draft_fingerprint" VARCHAR(64),
  "approved_settings" JSONB,
  "approved_fingerprint" VARCHAR(64),
  "approved_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "analysis_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_upload_generation_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_upload_generation_profiles_submission_id_fkey"
    FOREIGN KEY ("submission_id") REFERENCES "story_upload_submissions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_story_upload_generation_profiles_version"
  ON "story_upload_generation_profiles"("submission_id", "profile_version");
CREATE UNIQUE INDEX "uq_story_upload_generation_profiles_owner"
  ON "story_upload_generation_profiles"("id", "owner_user_id");
CREATE INDEX "idx_story_upload_generation_profiles_owner_status"
  ON "story_upload_generation_profiles"("owner_user_id", "status", "updated_at");

CREATE TABLE "story_work_generation_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "analysis_job_id" UUID NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "profile_version" INTEGER NOT NULL DEFAULT 1,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'needs_review',
  "draft_settings" JSONB NOT NULL DEFAULT '{}',
  "draft_fingerprint" VARCHAR(64),
  "approved_settings" JSONB,
  "approved_fingerprint" VARCHAR(64),
  "approved_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "analysis_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_work_generation_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_work_generation_profiles_work_id_fkey"
    FOREIGN KEY ("work_id") REFERENCES "story_works"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_work_generation_profiles_manuscript_version_id_fkey"
    FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_work_generation_profiles_analysis_job_id_fkey"
    FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_story_work_generation_profiles_version"
  ON "story_work_generation_profiles"("work_id", "profile_version");
CREATE INDEX "idx_story_work_generation_profiles_analysis"
  ON "story_work_generation_profiles"("analysis_job_id");
CREATE INDEX "idx_story_work_generation_profiles_owner_status"
  ON "story_work_generation_profiles"("owner_user_id", "status", "updated_at");

CREATE TABLE "artist_story_identity_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "artist_id" UUID NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "reference_asset_ids" JSONB NOT NULL DEFAULT '[]',
  "profile_version" INTEGER NOT NULL DEFAULT 1,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending_analysis',
  "draft_settings" JSONB NOT NULL DEFAULT '{}',
  "draft_fingerprint" VARCHAR(64),
  "approved_settings" JSONB,
  "approved_fingerprint" VARCHAR(64),
  "approved_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "analysis_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artist_story_identity_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "artist_story_identity_profiles_artist_id_fkey"
    FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_artist_story_identity_profiles_version"
  ON "artist_story_identity_profiles"("artist_id", "profile_version");
CREATE INDEX "idx_artist_story_identity_profiles_status"
  ON "artist_story_identity_profiles"("artist_id", "status", "updated_at");
