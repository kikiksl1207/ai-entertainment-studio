CREATE TABLE "story_author_body_trial_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "release_checksum" TEXT NOT NULL,
  "capability_revision" INTEGER NOT NULL,
  "style_consent_id" UUID NOT NULL,
  "style_consent_revision" INTEGER NOT NULL,
  "analysis_job_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL,
  "generation_profile_id" UUID,
  "generation_profile_revision" INTEGER,
  "generation_profile_fingerprint" TEXT,
  "approved_budget_krw" DECIMAL(18,6) NOT NULL,
  "approval_reference" VARCHAR(128) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_author_body_trial_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_author_body_trial_budget_check" CHECK (approved_budget_krw > 0 AND approved_budget_krw <= 10000),
  CONSTRAINT "story_author_body_trial_revision_check" CHECK (capability_revision > 0 AND style_consent_revision > 0 AND analysis_version > 0),
  CONSTRAINT "story_author_body_trial_status_check" CHECK (status IN ('active', 'revoked')),
  CONSTRAINT "story_author_body_trial_owner_fk" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT "story_author_body_trial_work_fk" FOREIGN KEY (work_id) REFERENCES story_works(id) ON DELETE RESTRICT,
  CONSTRAINT "story_author_body_trial_release_fk" FOREIGN KEY (release_id) REFERENCES story_releases(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_story_author_body_trial_approval_reference" ON "story_author_body_trial_approvals"(approval_reference);
CREATE INDEX "idx_story_author_body_trial_owner_work" ON "story_author_body_trial_approvals"(user_id, work_id, status);
CREATE UNIQUE INDEX "uq_story_author_body_trial_active" ON "story_author_body_trial_approvals"(user_id, work_id) WHERE status = 'active';
ALTER TABLE "story_ai_continuations" ADD COLUMN "author_body_trial_approval_id" UUID;
ALTER TABLE "story_ai_continuations" ADD CONSTRAINT "story_ai_continuations_body_trial_approval_fk"
  FOREIGN KEY (author_body_trial_approval_id) REFERENCES story_author_body_trial_approvals(id) ON DELETE RESTRICT;
CREATE TABLE "story_author_body_trial_commands" (
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "work_id" UUID NOT NULL,
  "approval_id" UUID NOT NULL,
  "progress_id" UUID NOT NULL,
  "choice_id" UUID NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "locale" TEXT NOT NULL,
  "receipt" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT "story_author_body_trial_command_approval_fk" FOREIGN KEY (approval_id)
    REFERENCES story_author_body_trial_approvals(id) ON DELETE RESTRICT,
  CONSTRAINT "story_author_body_trial_command_progress_fk" FOREIGN KEY (progress_id)
    REFERENCES story_reader_progress(id) ON DELETE RESTRICT,
  CONSTRAINT "story_author_body_trial_command_revision_check" CHECK (source_revision > 0)
);
