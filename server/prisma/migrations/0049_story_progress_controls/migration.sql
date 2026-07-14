ALTER TABLE "story_works"
  ADD COLUMN "published_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "custom_choice_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "story_parts"
  ADD COLUMN "act_number" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "story_reader_progress"
  ADD COLUMN "current_act" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "progress_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "story_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "visited_ending_keys" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "story_choice_events"
  ADD COLUMN "invalidated_at" TIMESTAMPTZ(6),
  ADD COLUMN "reset_command_id" UUID;

CREATE TABLE "story_progress_checkpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "progress_id" UUID NOT NULL,
  "progress_revision" INTEGER NOT NULL,
  "story_version" INTEGER NOT NULL,
  "scene_id" UUID NOT NULL,
  "beat_position" INTEGER NOT NULL,
  "act_number" INTEGER NOT NULL,
  "visited_ending_keys" JSONB NOT NULL DEFAULT '[]',
  "checkpoint_status" TEXT NOT NULL DEFAULT 'confirmed',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_progress_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_progress_checkpoints_revision_check" CHECK ("progress_revision" > 0),
  CONSTRAINT "story_progress_checkpoints_beat_check" CHECK ("beat_position" >= 0)
);
CREATE UNIQUE INDEX "story_progress_checkpoints_progress_id_progress_revision_key"
  ON "story_progress_checkpoints"("progress_id", "progress_revision");
CREATE INDEX "idx_story_checkpoints_progress_created"
  ON "story_progress_checkpoints"("progress_id", "created_at");

CREATE TABLE "story_reset_quota_buckets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "scope_key" TEXT NOT NULL,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "limit_count" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reset_quota_buckets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reset_quota_counts_check" CHECK (
    "used_count" >= 0 AND "limit_count" >= 0 AND "revision" > 0
  )
);
CREATE UNIQUE INDEX "story_reset_quota_buckets_user_id_work_id_scope_key_key"
  ON "story_reset_quota_buckets"("user_id", "work_id", "scope_key");
CREATE INDEX "idx_story_reset_quota_user_work"
  ON "story_reset_quota_buckets"("user_id", "work_id");

CREATE TABLE "story_reset_quota_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quota_bucket_id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "added_uses" INTEGER NOT NULL,
  "before_limit" INTEGER NOT NULL,
  "after_limit" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reset_quota_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reset_quota_adjustments_uses_check" CHECK (
    "added_uses" > 0 AND "after_limit" = "before_limit" + "added_uses"
  )
);
CREATE UNIQUE INDEX "story_reset_quota_adjustments_idempotency_key_key"
  ON "story_reset_quota_adjustments"("idempotency_key");
CREATE INDEX "idx_story_reset_adjustments_bucket"
  ON "story_reset_quota_adjustments"("quota_bucket_id", "created_at");

CREATE TABLE "story_reset_commands" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "progress_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_act" INTEGER,
  "before_revision" INTEGER NOT NULL,
  "after_revision" INTEGER NOT NULL,
  "invalidated_event_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reset_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_reset_commands_target_check" CHECK ("target_type" IN ('full', 'act'))
);
CREATE UNIQUE INDEX "story_reset_commands_idempotency_key_key"
  ON "story_reset_commands"("idempotency_key");
CREATE INDEX "idx_story_reset_commands_progress"
  ON "story_reset_commands"("progress_id", "created_at");

CREATE TABLE "story_custom_choices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "progress_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "scene_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "private_input" TEXT NOT NULL,
  "moderation_decision" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'accepted',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_custom_choices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_custom_choices_input_length_check" CHECK (
    char_length("private_input") BETWEEN 1 AND 500
  )
);
CREATE UNIQUE INDEX "story_custom_choices_idempotency_key_key"
  ON "story_custom_choices"("idempotency_key");
CREATE INDEX "idx_story_custom_choices_progress"
  ON "story_custom_choices"("progress_id", "created_at");

ALTER TABLE "story_progress_checkpoints"
  ADD CONSTRAINT "story_progress_checkpoints_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "story_reader_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_progress_checkpoints_scene_id_fkey"
  FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_reset_quota_buckets"
  ADD CONSTRAINT "story_reset_quota_buckets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_reset_quota_buckets_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_reset_quota_adjustments"
  ADD CONSTRAINT "story_reset_quota_adjustments_bucket_id_fkey"
  FOREIGN KEY ("quota_bucket_id") REFERENCES "story_reset_quota_buckets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_reset_quota_adjustments_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_reset_commands"
  ADD CONSTRAINT "story_reset_commands_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "story_reader_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_reset_commands_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_choice_events"
  ADD CONSTRAINT "story_choice_events_reset_command_id_fkey"
  FOREIGN KEY ("reset_command_id") REFERENCES "story_reset_commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "story_custom_choices"
  ADD CONSTRAINT "story_custom_choices_progress_id_fkey"
  FOREIGN KEY ("progress_id") REFERENCES "story_reader_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_custom_choices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_custom_choices_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_custom_choices_scene_id_fkey"
  FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
