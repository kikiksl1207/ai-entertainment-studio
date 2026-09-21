BEGIN;

ALTER TABLE "story_ai_continuations"
  ADD COLUMN "request_kind" TEXT,
  ADD COLUMN "recommended_choice_id" UUID,
  ADD COLUMN "generated_choice_id" UUID,
  ADD COLUMN "style_consent_revision" INTEGER,
  ADD COLUMN "source_part_id" UUID,
  ADD COLUMN "source_generated_scene_id" UUID,
  ADD COLUMN "manuscript_version_id" UUID,
  ADD COLUMN "analysis_job_id" UUID,
  ADD COLUMN "analysis_version" INTEGER,
  ADD COLUMN "rights_contract_id" UUID,
  ADD COLUMN "rights_contract_version_id" UUID,
  ADD COLUMN "release_checksum" TEXT,
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "context_fingerprint" TEXT,
  ADD COLUMN "prompt_version" TEXT,
  ADD COLUMN "output_schema_version" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_error_code" TEXT;

ALTER TABLE "story_ai_continuations"
  ADD COLUMN "result_generated_scene_id" UUID;

ALTER TABLE "story_reader_progress"
  ADD COLUMN "current_generated_scene_id" UUID,
  ADD CONSTRAINT "story_reader_progress_current_scene_xor_check" CHECK (
    num_nonnulls("current_scene_id", "current_generated_scene_id") <= 1
  );

ALTER TABLE "story_ai_continuations"
  ALTER COLUMN "custom_choice_id" DROP NOT NULL,
  ALTER COLUMN "source_scene_id" DROP NOT NULL;

UPDATE "story_ai_continuations" AS continuation
SET
  "request_kind" = 'custom_choice',
  "style_consent_revision" = consent."revision",
  "source_part_id" = scene."part_id",
  "manuscript_version_id" = release."manuscript_version_id",
  "release_checksum" = release."checksum",
  "locale" = manuscript."locale",
  "context_fingerprint" = 'legacy:' || continuation."id"::text,
  "prompt_version" = 'legacy',
  "output_schema_version" = 'legacy'
FROM "story_scenes" AS scene,
     "story_releases" AS release,
     "story_style_profile_consents" AS consent,
     "story_manuscript_versions" AS manuscript
WHERE scene."id" = continuation."source_scene_id"
  AND release."id" = continuation."release_id"
  AND release."work_id" = continuation."work_id"
  AND consent."id" = continuation."style_consent_id"
  AND consent."work_id" = continuation."work_id"
  AND manuscript."id" = release."manuscript_version_id"
  AND manuscript."work_id" = continuation."work_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "story_ai_continuations"
    WHERE "request_kind" IS NULL
       OR "style_consent_revision" IS NULL
       OR "source_part_id" IS NULL
       OR "manuscript_version_id" IS NULL
       OR "release_checksum" IS NULL
       OR "locale" IS NULL
       OR "context_fingerprint" IS NULL
  ) THEN
    RAISE EXCEPTION 'story_ai_continuation backfill dependency mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "story_ai_continuations" WHERE "status" = 'processing'
  ) THEN
    RAISE EXCEPTION 'legacy processing continuation requires operator recovery before migration';
  END IF;
END $$;

ALTER TABLE "story_ai_continuations"
  ALTER COLUMN "request_kind" SET NOT NULL,
  ALTER COLUMN "request_kind" SET DEFAULT 'custom_choice',
  ALTER COLUMN "style_consent_revision" SET NOT NULL,
  ALTER COLUMN "style_consent_revision" SET DEFAULT 1,
  ALTER COLUMN "source_part_id" SET NOT NULL,
  ALTER COLUMN "locale" SET NOT NULL,
  ALTER COLUMN "locale" SET DEFAULT 'ko',
  ALTER COLUMN "context_fingerprint" SET NOT NULL,
  ALTER COLUMN "context_fingerprint" SET DEFAULT '',
  ALTER COLUMN "prompt_version" SET NOT NULL,
  ALTER COLUMN "prompt_version" SET DEFAULT 'legacy',
  ALTER COLUMN "output_schema_version" SET NOT NULL,
  ALTER COLUMN "output_schema_version" SET DEFAULT 'legacy';

CREATE UNIQUE INDEX "uq_story_parts_work_id"
  ON "story_parts"("work_id", "id");
CREATE UNIQUE INDEX "uq_story_scenes_part_id"
  ON "story_scenes"("part_id", "id");
CREATE UNIQUE INDEX "uq_story_choices_scene_id"
  ON "story_choices"("scene_id", "id");
CREATE UNIQUE INDEX "uq_story_releases_work_id"
  ON "story_releases"("work_id", "id");
CREATE UNIQUE INDEX "uq_story_style_consents_work_id"
  ON "story_style_profile_consents"("work_id", "id");
CREATE UNIQUE INDEX "uq_story_reader_progress_user_work_id"
  ON "story_reader_progress"("user_id", "work_id", "id");
CREATE UNIQUE INDEX "uq_story_ai_continuations_owner_scope"
  ON "story_ai_continuations"("id", "user_id", "work_id", "release_id", "progress_id");

ALTER TABLE "story_ai_continuations"
  ADD CONSTRAINT "story_ai_continuations_request_source_check" CHECK (
    ("request_kind" = 'custom_choice'
      AND "custom_choice_id" IS NOT NULL
      AND "recommended_choice_id" IS NULL
      AND "generated_choice_id" IS NULL)
    OR
    ("request_kind" = 'recommended_choice'
      AND "custom_choice_id" IS NULL
      AND num_nonnulls("recommended_choice_id", "generated_choice_id") = 1)
  ),
  ADD CONSTRAINT "story_ai_continuations_source_pair_check" CHECK (
    ("recommended_choice_id" IS NOT NULL
      AND "source_scene_id" IS NOT NULL
      AND "source_generated_scene_id" IS NULL)
    OR
    ("generated_choice_id" IS NOT NULL
      AND "source_scene_id" IS NULL
      AND "source_generated_scene_id" IS NOT NULL)
    OR
    ("request_kind" = 'custom_choice'
      AND "source_scene_id" IS NOT NULL
      AND "source_generated_scene_id" IS NULL)
  ),
  ADD CONSTRAINT "story_ai_continuations_nullable_pin_pairs_check" CHECK (
    num_nonnulls("analysis_job_id", "analysis_version") IN (0, 2)
    AND num_nonnulls("rights_contract_id", "rights_contract_version_id") IN (0, 2)
  ),
  ADD CONSTRAINT "story_ai_continuations_lease_state_check" CHECK (
    ("status" = 'processing'
      AND "lease_token" IS NOT NULL
      AND "lease_owner" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL)
    OR
    ("status" <> 'processing'
      AND "lease_token" IS NULL
      AND "lease_owner" IS NULL
      AND "lease_expires_at" IS NULL)
  ),
  ADD CONSTRAINT "story_ai_continuations_attempt_bounds_check" CHECK (
    "attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 10 AND "attempt_count" <= "max_attempts"
  ),
  ADD CONSTRAINT "story_ai_continuations_recommended_result_overlay_check" CHECK (
    "request_kind" <> 'recommended_choice' OR "result_scene_id" IS NULL
  ),
  ADD CONSTRAINT "story_ai_continuations_recommended_pins_check" CHECK (
    "request_kind" <> 'recommended_choice' OR (
      "source_part_id" IS NOT NULL
      AND "manuscript_version_id" IS NOT NULL
      AND "analysis_job_id" IS NOT NULL
      AND "analysis_version" IS NOT NULL
      AND "rights_contract_id" IS NOT NULL
      AND "rights_contract_version_id" IS NOT NULL
      AND "release_checksum" IS NOT NULL
      AND "context_fingerprint" <> ''
      AND "prompt_version" <> 'legacy'
      AND "output_schema_version" <> 'legacy'
    )
  ),
  ADD CONSTRAINT "story_ai_continuations_progress_work_fk"
    FOREIGN KEY ("work_id", "progress_id")
    REFERENCES "story_reader_progress"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_progress_owner_fk"
    FOREIGN KEY ("user_id", "work_id", "progress_id")
    REFERENCES "story_reader_progress"("user_id", "work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_release_work_fk"
    FOREIGN KEY ("work_id", "release_id")
    REFERENCES "story_releases"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_part_work_fk"
    FOREIGN KEY ("work_id", "source_part_id")
    REFERENCES "story_parts"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_scene_part_fk"
    FOREIGN KEY ("source_part_id", "source_scene_id")
    REFERENCES "story_scenes"("part_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_recommended_choice_scene_fk"
    FOREIGN KEY ("source_scene_id", "recommended_choice_id")
    REFERENCES "story_choices"("scene_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_custom_choice_fk"
    FOREIGN KEY ("custom_choice_id")
    REFERENCES "story_custom_choices"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_manuscript_work_fk"
    FOREIGN KEY ("work_id", "manuscript_version_id")
    REFERENCES "story_manuscript_versions"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_analysis_work_fk"
    FOREIGN KEY ("work_id", "analysis_job_id", "analysis_version")
    REFERENCES "story_analysis_jobs"("work_id", "id", "analysis_version") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_style_work_fk"
    FOREIGN KEY ("work_id", "style_consent_id")
    REFERENCES "story_style_profile_consents"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_rights_version_fk"
    FOREIGN KEY ("rights_contract_id", "rights_contract_version_id")
    REFERENCES "content_rights_contract_versions"("contract_id", "id") ON DELETE RESTRICT;

CREATE TABLE "story_ai_generated_scenes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "continuation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "progress_id" UUID NOT NULL,
  "source_part_id" UUID NOT NULL,
  "scene_key" TEXT NOT NULL,
  "result_checksum" TEXT NOT NULL,
  "provenance" TEXT NOT NULL DEFAULT 'ai_generated',
  "title" JSONB NOT NULL,
  "visual_manifest" JSONB NOT NULL,
  "ending_type" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_generated_scenes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_generated_scenes_status_check" CHECK ("status" IN ('ready', 'invalidated')),
  CONSTRAINT "story_ai_generated_scenes_provenance_check" CHECK ("provenance" = 'ai_generated'),
  CONSTRAINT "story_ai_generated_scenes_ending_check" CHECK ("ending_type" IS NULL OR "ending_type" = 'ai_generated')
);

CREATE TABLE "story_ai_generated_beats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scene_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "beat_type" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_generated_beats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_generated_beats_position_check" CHECK ("position" BETWEEN 1 AND 40)
);

CREATE TABLE "story_ai_generated_choices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scene_id" UUID NOT NULL,
  "choice_key" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "label" JSONB NOT NULL,
  "route_kind" TEXT NOT NULL DEFAULT 'generation_required',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_generated_choices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_generated_choices_route_check" CHECK ("route_kind" = 'generation_required'),
  CONSTRAINT "story_ai_generated_choices_position_check" CHECK ("position" BETWEEN 1 AND 3)
);

CREATE UNIQUE INDEX "story_ai_generated_scenes_continuation_id_key"
  ON "story_ai_generated_scenes"("continuation_id");
CREATE UNIQUE INDEX "uq_story_ai_generated_scenes_progress_id"
  ON "story_ai_generated_scenes"("progress_id", "id");
CREATE UNIQUE INDEX "uq_story_ai_generated_scenes_continuation_id"
  ON "story_ai_generated_scenes"("continuation_id", "id");
CREATE INDEX "idx_story_ai_generated_scenes_owner"
  ON "story_ai_generated_scenes"("user_id", "work_id", "release_id", "progress_id", "created_at");
CREATE INDEX "idx_story_ai_generated_scenes_reuse_candidate"
  ON "story_ai_generated_scenes"("work_id", "release_id", "result_checksum", "status");
CREATE UNIQUE INDEX "story_ai_generated_beats_scene_id_position_key"
  ON "story_ai_generated_beats"("scene_id", "position");
CREATE INDEX "idx_story_ai_generated_beats_scene"
  ON "story_ai_generated_beats"("scene_id", "position");
CREATE UNIQUE INDEX "story_ai_generated_choices_scene_id_choice_key_key"
  ON "story_ai_generated_choices"("scene_id", "choice_key");
CREATE UNIQUE INDEX "uq_story_ai_generated_choices_scene_id"
  ON "story_ai_generated_choices"("scene_id", "id");
CREATE INDEX "idx_story_ai_generated_choices_scene"
  ON "story_ai_generated_choices"("scene_id", "position");

ALTER TABLE "story_ai_generated_scenes"
  ADD CONSTRAINT "story_ai_generated_scenes_continuation_owner_fk"
    FOREIGN KEY ("continuation_id", "user_id", "work_id", "release_id", "progress_id")
    REFERENCES "story_ai_continuations"("id", "user_id", "work_id", "release_id", "progress_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_generated_scenes_progress_owner_fk"
    FOREIGN KEY ("user_id", "work_id", "progress_id")
    REFERENCES "story_reader_progress"("user_id", "work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_generated_scenes_release_work_fk"
    FOREIGN KEY ("work_id", "release_id")
    REFERENCES "story_releases"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_generated_scenes_part_work_fk"
    FOREIGN KEY ("work_id", "source_part_id")
    REFERENCES "story_parts"("work_id", "id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_generated_beats"
  ADD CONSTRAINT "story_ai_generated_beats_scene_fk"
    FOREIGN KEY ("scene_id") REFERENCES "story_ai_generated_scenes"("id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_generated_choices"
  ADD CONSTRAINT "story_ai_generated_choices_scene_fk"
    FOREIGN KEY ("scene_id") REFERENCES "story_ai_generated_scenes"("id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_continuations"
  ADD CONSTRAINT "story_ai_continuations_generated_choice_scene_fk"
    FOREIGN KEY ("source_generated_scene_id", "generated_choice_id")
    REFERENCES "story_ai_generated_choices"("scene_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_continuations_result_generated_scene_fk"
    FOREIGN KEY ("id", "result_generated_scene_id")
    REFERENCES "story_ai_generated_scenes"("continuation_id", "id") ON DELETE RESTRICT;

ALTER TABLE "story_reader_progress"
  ADD CONSTRAINT "story_reader_progress_generated_scene_fk"
    FOREIGN KEY ("id", "current_generated_scene_id")
    REFERENCES "story_ai_generated_scenes"("progress_id", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "assert_story_recommended_continuation_source"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."request_kind" = 'recommended_choice'
    AND NEW."recommended_choice_id" IS NOT NULL
    AND NOT EXISTS (
    SELECT 1
    FROM "story_choices" AS choice
    WHERE choice."id" = NEW."recommended_choice_id"
      AND choice."scene_id" = NEW."source_scene_id"
      AND choice."route_kind" = 'generation_required'
      AND choice."target_scene_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'recommended continuation requires a generation_required source choice';
  END IF;
  IF NEW."request_kind" = 'recommended_choice'
    AND NEW."generated_choice_id" IS NOT NULL
    AND NOT EXISTS (
    SELECT 1
    FROM "story_ai_generated_choices" AS choice
    JOIN "story_ai_generated_scenes" AS scene ON scene."id" = choice."scene_id"
    WHERE choice."id" = NEW."generated_choice_id"
      AND choice."scene_id" = NEW."source_generated_scene_id"
      AND choice."route_kind" = 'generation_required'
      AND scene."status" = 'ready'
      AND scene."user_id" = NEW."user_id"
      AND scene."work_id" = NEW."work_id"
      AND scene."release_id" = NEW."release_id"
      AND scene."progress_id" = NEW."progress_id"
  ) THEN
    RAISE EXCEPTION 'generated continuation choice must belong to the same reader progress';
  END IF;
  IF NEW."request_kind" = 'recommended_choice' AND NOT EXISTS (
    SELECT 1
    FROM "content_rights_contracts" AS contract
    JOIN "content_rights_contract_versions" AS version
      ON version."contract_id" = contract."id"
    WHERE contract."id" = NEW."rights_contract_id"
      AND contract."work_type" = 'story'
      AND contract."work_id" = NEW."work_id"
      AND version."id" = NEW."rights_contract_version_id"
      AND version."content_version_id" = NEW."manuscript_version_id"
  ) THEN
    RAISE EXCEPTION 'recommended continuation rights pin must match the story work and manuscript';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_ai_continuations_recommended_source_guard"
BEFORE INSERT OR UPDATE OF
  "request_kind", "recommended_choice_id", "source_scene_id",
  "generated_choice_id", "source_generated_scene_id",
  "user_id", "work_id", "release_id", "progress_id",
  "rights_contract_id", "rights_contract_version_id", "manuscript_version_id"
ON "story_ai_continuations"
FOR EACH ROW EXECUTE FUNCTION "assert_story_recommended_continuation_source"();

CREATE INDEX "idx_story_ai_continuations_claim"
  ON "story_ai_continuations"("status", "next_attempt_at", "lease_expires_at", "created_at");
CREATE INDEX "idx_story_ai_continuations_cache"
  ON "story_ai_continuations"("work_id", "release_id", "context_fingerprint", "status");
CREATE INDEX "idx_story_ai_continuations_recommended_choice"
  ON "story_ai_continuations"("source_scene_id", "recommended_choice_id");
CREATE INDEX "idx_story_ai_continuations_generated_choice"
  ON "story_ai_continuations"("source_generated_scene_id", "generated_choice_id");

COMMIT;
