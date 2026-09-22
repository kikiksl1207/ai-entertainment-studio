CREATE TABLE "story_progress_artist_participants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "progress_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "artist_id" UUID NOT NULL,
  "selection_source" VARCHAR(32) NOT NULL,
  "identity_profile_id" UUID,
  "identity_profile_version" INTEGER,
  "identity_review_revision" INTEGER,
  "identity_source_fingerprint" VARCHAR(64),
  "identity_approved_fingerprint" VARCHAR(64),
  "reference_asset_ids" JSONB NOT NULL DEFAULT '[]',
  "reference_checksums" JSONB NOT NULL DEFAULT '[]',
  "participant_fingerprint" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_progress_artist_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_progress_artist_participants_progress_fkey"
    FOREIGN KEY ("progress_id") REFERENCES "story_reader_progress"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_progress_artist_participants_artist_fkey"
    FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_progress_artist_participants_source" CHECK (
    "selection_source" IN ('liked', 'voted', 'liked_and_voted', 'search')
  ),
  CONSTRAINT "story_progress_artist_participants_fingerprint" CHECK (
    "participant_fingerprint" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "story_progress_artist_participants_identity_shape" CHECK (
    (
      "identity_profile_id" IS NULL AND
      "identity_profile_version" IS NULL AND
      "identity_review_revision" IS NULL AND
      "identity_source_fingerprint" IS NULL AND
      "identity_approved_fingerprint" IS NULL AND
      "reference_asset_ids" = '[]'::jsonb AND
      "reference_checksums" = '[]'::jsonb
    ) OR (
      "identity_profile_id" IS NOT NULL AND
      "identity_profile_version" >= 1 AND
      "identity_review_revision" >= 1 AND
      "identity_source_fingerprint" ~ '^[a-f0-9]{64}$' AND
      "identity_approved_fingerprint" ~ '^[a-f0-9]{64}$' AND
      jsonb_typeof("reference_asset_ids") = 'array' AND
      jsonb_array_length("reference_asset_ids") BETWEEN 1 AND 8 AND
      jsonb_typeof("reference_checksums") = 'array' AND
      jsonb_array_length("reference_checksums") = jsonb_array_length("reference_asset_ids")
    )
  )
);

CREATE UNIQUE INDEX "story_progress_artist_participants_progress_id_key"
  ON "story_progress_artist_participants"("progress_id");
CREATE UNIQUE INDEX "uq_story_progress_artist_participants_user_work"
  ON "story_progress_artist_participants"("user_id", "work_id");
CREATE INDEX "idx_story_progress_artist_participants_artist"
  ON "story_progress_artist_participants"("artist_id", "created_at");
