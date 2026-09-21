BEGIN;

ALTER TABLE "story_ai_continuations"
  ADD COLUMN "reusable_context_fingerprint" TEXT,
  ADD COLUMN "reuse_key" TEXT,
  ADD COLUMN "shared_result_id" UUID,
  ADD CONSTRAINT "story_ai_continuations_reuse_tuple_check" CHECK (
    num_nonnulls("reusable_context_fingerprint", "reuse_key", "shared_result_id") IN (0, 3)
  );

ALTER TABLE "story_ai_generated_scenes"
  DROP CONSTRAINT "story_ai_generated_scenes_provenance_check",
  ADD COLUMN "shared_result_id" UUID,
  ADD CONSTRAINT "story_ai_generated_scenes_reuse_provenance_check" CHECK (
    "provenance" = 'ai_generated'
    OR ("provenance" = 'ai_reused' AND "shared_result_id" IS NOT NULL)
  );

CREATE TABLE "story_ai_reusable_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reuse_key" TEXT NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "release_checksum" TEXT NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_canonical_scene_id" UUID,
  "source_canonical_choice_id" UUID,
  "source_shared_result_id" UUID,
  "source_shared_choice_key" TEXT,
  "source_fingerprint" TEXT NOT NULL,
  "semantic_path_fingerprint" TEXT NOT NULL,
  "context_fingerprint" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "output_schema_version" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "rate_card_version" TEXT NOT NULL,
  "cost_policy_version" TEXT NOT NULL,
  "rights_activation_key" TEXT NOT NULL,
  "moderation_policy_version" TEXT NOT NULL,
  "moderation_evidence_version" TEXT NOT NULL,
  "quality_policy_version" TEXT NOT NULL,
  "claim_token" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result_checksum" TEXT,
  "title" JSONB,
  "visual_manifest" JSONB,
  "ending_key" TEXT,
  "approved_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "revoke_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_reusable_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_reusable_results_source_check" CHECK (
    ("source_kind" = 'canonical'
      AND "source_canonical_scene_id" IS NOT NULL
      AND "source_canonical_choice_id" IS NOT NULL
      AND "source_shared_result_id" IS NULL
      AND "source_shared_choice_key" IS NULL)
    OR
    ("source_kind" = 'generated'
      AND "source_canonical_scene_id" IS NULL
      AND "source_canonical_choice_id" IS NULL
      AND "source_shared_result_id" IS NOT NULL
      AND "source_shared_choice_key" IS NOT NULL
      AND "source_shared_choice_key" <> '')
  ),
  CONSTRAINT "story_ai_reusable_results_lifecycle_check" CHECK (
    ("status" = 'pending'
      AND "result_checksum" IS NULL
      AND "title" IS NULL
      AND "visual_manifest" IS NULL
      AND "approved_at" IS NULL
      AND "revoked_at" IS NULL
      AND "revoke_reason" IS NULL)
    OR
    ("status" = 'approved'
      AND "claim_token" IS NULL
      AND "result_checksum" IS NOT NULL
      AND "title" IS NOT NULL
      AND "visual_manifest" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "revoked_at" IS NULL
      AND "revoke_reason" IS NULL)
    OR
    ("status" = 'revoked'
      AND "claim_token" IS NULL
      AND "revoked_at" IS NOT NULL
      AND "revoke_reason" IS NOT NULL)
  ),
  CONSTRAINT "story_ai_reusable_results_nonempty_snapshot_check" CHECK (
    "reuse_key" <> ''
    AND "release_checksum" <> ''
    AND "source_fingerprint" <> ''
    AND "semantic_path_fingerprint" <> ''
    AND "context_fingerprint" <> ''
    AND "prompt_version" <> ''
    AND "output_schema_version" <> ''
    AND "locale" <> ''
    AND "provider" <> ''
    AND "model" <> ''
    AND "rate_card_version" <> ''
    AND "cost_policy_version" <> ''
    AND "rights_activation_key" <> ''
    AND "moderation_policy_version" <> ''
    AND "moderation_evidence_version" <> ''
    AND "quality_policy_version" <> ''
  )
);

CREATE TABLE "story_ai_reusable_beats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shared_result_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "beat_type" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_reusable_beats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_reusable_beats_position_check" CHECK ("position" BETWEEN 1 AND 40),
  CONSTRAINT "story_ai_reusable_beats_type_check" CHECK ("beat_type" <> '')
);

CREATE TABLE "story_ai_reusable_choices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shared_result_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "choice_key" TEXT NOT NULL,
  "label" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_reusable_choices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_ai_reusable_choices_position_check" CHECK ("position" BETWEEN 1 AND 3),
  CONSTRAINT "story_ai_reusable_choices_key_check" CHECK ("choice_key" <> '')
);

CREATE UNIQUE INDEX "story_ai_reusable_results_reuse_key_key"
  ON "story_ai_reusable_results"("reuse_key");
CREATE UNIQUE INDEX "uq_story_ai_reusable_results_owner"
  ON "story_ai_reusable_results"("id", "work_id", "release_id");
CREATE INDEX "idx_story_ai_reusable_results_release"
  ON "story_ai_reusable_results"("work_id", "release_id", "status", "created_at");
CREATE INDEX "idx_story_ai_reusable_results_lifecycle"
  ON "story_ai_reusable_results"("status", "updated_at");
CREATE UNIQUE INDEX "story_ai_reusable_beats_shared_result_id_position_key"
  ON "story_ai_reusable_beats"("shared_result_id", "position");
CREATE UNIQUE INDEX "story_ai_reusable_choices_shared_result_id_position_key"
  ON "story_ai_reusable_choices"("shared_result_id", "position");
CREATE UNIQUE INDEX "story_ai_reusable_choices_shared_result_id_choice_key_key"
  ON "story_ai_reusable_choices"("shared_result_id", "choice_key");
CREATE INDEX "idx_story_ai_continuations_shared_result"
  ON "story_ai_continuations"("shared_result_id", "status");

ALTER TABLE "story_ai_reusable_results"
  ADD CONSTRAINT "story_ai_reusable_results_release_work_fk"
    FOREIGN KEY ("work_id", "release_id")
    REFERENCES "story_releases"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_reusable_results_manuscript_work_fk"
    FOREIGN KEY ("work_id", "manuscript_version_id")
    REFERENCES "story_manuscript_versions"("work_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_reusable_results_source_choice_fk"
    FOREIGN KEY ("source_canonical_scene_id", "source_canonical_choice_id")
    REFERENCES "story_choices"("scene_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_ai_reusable_results_source_shared_fk"
    FOREIGN KEY ("source_shared_result_id")
    REFERENCES "story_ai_reusable_results"("id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_reusable_beats"
  ADD CONSTRAINT "story_ai_reusable_beats_result_fk"
    FOREIGN KEY ("shared_result_id")
    REFERENCES "story_ai_reusable_results"("id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_reusable_choices"
  ADD CONSTRAINT "story_ai_reusable_choices_result_fk"
    FOREIGN KEY ("shared_result_id")
    REFERENCES "story_ai_reusable_results"("id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_continuations"
  ADD CONSTRAINT "story_ai_continuations_shared_result_owner_fk"
    FOREIGN KEY ("shared_result_id", "work_id", "release_id")
    REFERENCES "story_ai_reusable_results"("id", "work_id", "release_id") ON DELETE RESTRICT;

ALTER TABLE "story_ai_generated_scenes"
  ADD CONSTRAINT "story_ai_generated_scenes_shared_result_owner_fk"
    FOREIGN KEY ("shared_result_id", "work_id", "release_id")
    REFERENCES "story_ai_reusable_results"("id", "work_id", "release_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "guard_story_ai_reusable_result"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  beat_count INTEGER;
  choice_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."reuse_key" IS DISTINCT FROM OLD."reuse_key"
    OR NEW."work_id" IS DISTINCT FROM OLD."work_id"
    OR NEW."release_id" IS DISTINCT FROM OLD."release_id"
    OR NEW."release_checksum" IS DISTINCT FROM OLD."release_checksum"
    OR NEW."manuscript_version_id" IS DISTINCT FROM OLD."manuscript_version_id"
    OR NEW."source_kind" IS DISTINCT FROM OLD."source_kind"
    OR NEW."source_canonical_scene_id" IS DISTINCT FROM OLD."source_canonical_scene_id"
    OR NEW."source_canonical_choice_id" IS DISTINCT FROM OLD."source_canonical_choice_id"
    OR NEW."source_shared_result_id" IS DISTINCT FROM OLD."source_shared_result_id"
    OR NEW."source_shared_choice_key" IS DISTINCT FROM OLD."source_shared_choice_key"
    OR NEW."source_fingerprint" IS DISTINCT FROM OLD."source_fingerprint"
    OR NEW."semantic_path_fingerprint" IS DISTINCT FROM OLD."semantic_path_fingerprint"
    OR NEW."context_fingerprint" IS DISTINCT FROM OLD."context_fingerprint"
    OR NEW."prompt_version" IS DISTINCT FROM OLD."prompt_version"
    OR NEW."output_schema_version" IS DISTINCT FROM OLD."output_schema_version"
    OR NEW."locale" IS DISTINCT FROM OLD."locale"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."rate_card_version" IS DISTINCT FROM OLD."rate_card_version"
    OR NEW."cost_policy_version" IS DISTINCT FROM OLD."cost_policy_version"
    OR NEW."rights_activation_key" IS DISTINCT FROM OLD."rights_activation_key"
    OR NEW."moderation_policy_version" IS DISTINCT FROM OLD."moderation_policy_version"
    OR NEW."moderation_evidence_version" IS DISTINCT FROM OLD."moderation_evidence_version"
    OR NEW."quality_policy_version" IS DISTINCT FROM OLD."quality_policy_version"
  ) THEN
    RAISE EXCEPTION 'story AI reusable result snapshot is immutable';
  END IF;
  IF NEW."source_kind" = 'generated' AND NOT EXISTS (
    SELECT 1 FROM "story_ai_reusable_results" AS source_result
    WHERE source_result."id" = NEW."source_shared_result_id"
      AND source_result."status" = 'approved'
  ) THEN
    RAISE EXCEPTION 'generated reusable result requires an approved shared source';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'pending' AND (
    NEW."result_checksum" IS DISTINCT FROM OLD."result_checksum"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."visual_manifest" IS DISTINCT FROM OLD."visual_manifest"
    OR NEW."ending_key" IS DISTINCT FROM OLD."ending_key"
  ) THEN
    RAISE EXCEPTION 'approved story AI reusable output is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('pending', 'approved', 'revoked'))
    OR (OLD."status" = 'approved' AND NEW."status" IN ('approved', 'revoked'))
    OR (OLD."status" = 'revoked' AND NEW."status" = 'revoked')
  ) THEN
    RAISE EXCEPTION 'invalid story AI reusable result lifecycle transition';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" = 'approved' AND OLD."status" = 'pending' THEN
    SELECT COUNT(*) INTO beat_count
    FROM "story_ai_reusable_beats" WHERE "shared_result_id" = NEW."id";
    SELECT COUNT(*) INTO choice_count
    FROM "story_ai_reusable_choices" WHERE "shared_result_id" = NEW."id";
    IF beat_count NOT BETWEEN 1 AND 40
      OR choice_count NOT BETWEEN 0 AND 3
      OR ((choice_count > 0) = (NEW."ending_key" IS NOT NULL)) THEN
      RAISE EXCEPTION 'story AI reusable result output is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_ai_reusable_results_guard"
BEFORE INSERT OR UPDATE ON "story_ai_reusable_results"
FOR EACH ROW EXECUTE FUNCTION "guard_story_ai_reusable_result"();

CREATE OR REPLACE FUNCTION "guard_story_ai_reusable_child"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'story AI reusable result children are immutable';
  END IF;
  SELECT "status" INTO parent_status
  FROM "story_ai_reusable_results" WHERE "id" = NEW."shared_result_id" FOR UPDATE;
  IF parent_status <> 'pending' THEN
    RAISE EXCEPTION 'story AI reusable child requires pending parent';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_ai_reusable_beats_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "story_ai_reusable_beats"
FOR EACH ROW EXECUTE FUNCTION "guard_story_ai_reusable_child"();

CREATE TRIGGER "story_ai_reusable_choices_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "story_ai_reusable_choices"
FOR EACH ROW EXECUTE FUNCTION "guard_story_ai_reusable_child"();

COMMIT;
