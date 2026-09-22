CREATE TABLE "story_visual_prompts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL REFERENCES "story_works"("id") ON DELETE CASCADE,
  "release_id" UUID NOT NULL,
  "release_checksum" VARCHAR(64) NOT NULL,
  "source_scene_key" VARCHAR(160) NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "prompt_sha256" VARCHAR(64) NOT NULL,
  "source_kind" VARCHAR(32) NOT NULL,
  "source_binding_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_visual_prompts_key_format" CHECK (
    "source_scene_key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$'
  ),
  CONSTRAINT "story_visual_prompts_hash_format" CHECK (
    "prompt_sha256" ~ '^[a-f0-9]{64}$' AND
    "source_binding_sha256" ~ '^[a-f0-9]{64}$' AND
    "release_checksum" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "story_visual_prompts_text_bounds" CHECK (
    length(btrim("prompt_text")) BETWEEN 20 AND 32000
  ),
  CONSTRAINT "story_visual_prompts_source_kind" CHECK (
    "source_kind" IN ('authored_import', 'admin_verified')
  ),
  CONSTRAINT "story_visual_prompts_release_fk"
    FOREIGN KEY ("release_id", "work_id") REFERENCES "story_releases" ("id", "work_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "uq_story_visual_prompts_release_scene"
  ON "story_visual_prompts" ("work_id", "release_id", "source_scene_key");
CREATE UNIQUE INDEX "uq_story_visual_prompts_generation_binding"
  ON "story_visual_prompts" ("work_id", "release_id", "source_scene_key", "prompt_sha256");
CREATE UNIQUE INDEX "uq_story_visual_prompts_checksum_binding"
  ON "story_visual_prompts" ("work_id", "release_id", "source_scene_key", "prompt_sha256", "release_checksum");
CREATE INDEX "idx_story_visual_prompts_release"
  ON "story_visual_prompts" ("work_id", "release_id", "created_at");

CREATE TABLE "story_visual_generations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL REFERENCES "story_works"("id") ON DELETE CASCADE,
  "release_id" UUID NOT NULL,
  "release_checksum" VARCHAR(64) NOT NULL,
  "source_scene_key" VARCHAR(160) NOT NULL,
  "prompt_sha256" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "provider" VARCHAR(32),
  "model" VARCHAR(80),
  "quality" VARCHAR(16),
  "size" VARCHAR(32),
  "asset_id" UUID REFERENCES "assets"("id") ON DELETE RESTRICT,
  "checksum_sha256" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(80),
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_visual_generations_prompt_fk"
    FOREIGN KEY ("work_id", "release_id", "source_scene_key", "prompt_sha256", "release_checksum")
    REFERENCES "story_visual_prompts" ("work_id", "release_id", "source_scene_key", "prompt_sha256", "release_checksum")
    ON DELETE RESTRICT,
  CONSTRAINT "story_visual_generations_status" CHECK (
    "status" IN ('pending', 'generating', 'ready', 'failed')
  ),
  CONSTRAINT "story_visual_generations_attempt_bounds" CHECK (
    "attempt_count" BETWEEN 0 AND 1
  ),
  CONSTRAINT "story_visual_generations_release_checksum" CHECK ("release_checksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "story_visual_generations_ready_shape" CHECK (
    ("status" = 'ready' AND "asset_id" IS NOT NULL AND "checksum_sha256" ~ '^[a-f0-9]{64}$' AND "completed_at" IS NOT NULL) OR
    ("status" <> 'ready' AND "asset_id" IS NULL AND "completed_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "uq_story_visual_generations_release_scene"
  ON "story_visual_generations" ("work_id", "release_id", "source_scene_key");
CREATE INDEX "idx_story_visual_generations_release_status"
  ON "story_visual_generations" ("work_id", "release_id", "status", "updated_at");
CREATE INDEX "idx_story_visual_generations_status"
  ON "story_visual_generations" ("status", "updated_at");

CREATE FUNCTION story_visual_prompt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORY_VISUAL_PROMPT_IMMUTABLE';
END;
$$;

CREATE FUNCTION story_visual_prompt_release_checksum_valid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "story_releases"
    WHERE "id" = NEW."release_id" AND "work_id" = NEW."work_id" AND "checksum" = NEW."release_checksum"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORY_VISUAL_RELEASE_CHECKSUM_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_visual_prompt_release_checksum_valid"
  BEFORE INSERT ON "story_visual_prompts"
  FOR EACH ROW EXECUTE FUNCTION story_visual_prompt_release_checksum_valid();

CREATE TRIGGER "story_visual_prompt_immutable"
  BEFORE UPDATE OR DELETE ON "story_visual_prompts"
  FOR EACH ROW EXECUTE FUNCTION story_visual_prompt_immutable();
