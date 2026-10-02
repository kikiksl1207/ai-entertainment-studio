CREATE TABLE "story_publication_choice_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "first_part_position" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "claim_token" UUID NOT NULL,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_publication_choice_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_publication_choice_batches_identity"
    UNIQUE ("work_id", "release_id", "first_part_position"),
  CONSTRAINT "story_publication_choice_batches_status_check"
    CHECK ("status" IN ('in_progress', 'review_required', 'completed'))
);
