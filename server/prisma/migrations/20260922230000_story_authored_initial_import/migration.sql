ALTER TABLE "story_beats"
  ADD COLUMN "source_scene_key" TEXT,
  ADD COLUMN "visual_manifest" JSONB,
  ADD CONSTRAINT "story_beats_authored_visual_pair" CHECK (
    ("source_scene_key" IS NULL AND "visual_manifest" IS NULL) OR
    ("source_scene_key" IS NOT NULL AND "visual_manifest" IS NOT NULL AND
     "source_scene_key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$' AND
     jsonb_typeof("visual_manifest") = 'object' AND
     "visual_manifest" ? 'sceneKey' AND
     jsonb_typeof("visual_manifest" -> 'sceneKey') = 'string' AND
     "visual_manifest" ->> 'sceneKey' = "source_scene_key")
  );

CREATE UNIQUE INDEX "uq_story_works_authored_owner" ON "story_works" ("id", "owner_user_id");
CREATE UNIQUE INDEX "uq_story_releases_authored_manuscript"
  ON "story_releases" ("id", "work_id", "manuscript_version_id");

CREATE TABLE "story_authored_imports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL UNIQUE,
  "owner_user_id" UUID NOT NULL,
  "release_id" UUID NOT NULL UNIQUE,
  "manuscript_version_id" UUID NOT NULL,
  "idempotency_key_hash" TEXT NOT NULL,
  "source_map_sha256" TEXT NOT NULL,
  "declared_package_sha256" TEXT NOT NULL,
  "submitted_inventory_sha256" TEXT NOT NULL,
  "manuscript_content_hash" TEXT NOT NULL,
  "release_checksum" TEXT NOT NULL,
  "plan_checksum" TEXT NOT NULL,
  "materialized_checksum" TEXT NOT NULL,
  "contract" TEXT NOT NULL CHECK ("contract" = 'story-authored-initial-import-v1'),
  "locale" TEXT NOT NULL CHECK ("locale" IN ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant')),
  "part_count" INTEGER NOT NULL CHECK ("part_count" BETWEEN 1 AND 1000),
  "source_scene_count" INTEGER NOT NULL CHECK ("source_scene_count" >= "part_count"),
  "beat_count" INTEGER NOT NULL CHECK ("beat_count" BETWEEN "source_scene_count" AND "part_count" * 40),
  "choice_count" INTEGER NOT NULL CHECK ("choice_count" = "part_count" * 3),
  "act_count" INTEGER NOT NULL CHECK ("act_count" BETWEEN 1 AND "part_count"),
  "provenance" JSONB NOT NULL CHECK (jsonb_typeof("provenance") = 'object'),
  "ending_resolution" JSONB NOT NULL CHECK (jsonb_typeof("ending_resolution") = 'object'),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_authored_import_work_owner_fk" FOREIGN KEY ("work_id", "owner_user_id")
    REFERENCES "story_works" ("id", "owner_user_id") ON DELETE RESTRICT,
  CONSTRAINT "story_authored_import_manuscript_owner_fk"
    FOREIGN KEY ("manuscript_version_id", "work_id", "owner_user_id")
    REFERENCES "story_manuscript_versions" ("id", "work_id", "owner_user_id") ON DELETE RESTRICT,
  CONSTRAINT "story_authored_import_release_manuscript_fk"
    FOREIGN KEY ("release_id", "work_id", "manuscript_version_id")
    REFERENCES "story_releases" ("id", "work_id", "manuscript_version_id") ON DELETE RESTRICT,
  CONSTRAINT "story_authored_import_hashes" CHECK (
    "idempotency_key_hash" ~ '^[a-f0-9]{64}$' AND "source_map_sha256" ~ '^[a-f0-9]{64}$' AND
    "declared_package_sha256" ~ '^[a-f0-9]{64}$' AND "submitted_inventory_sha256" ~ '^[a-f0-9]{64}$' AND
    "manuscript_content_hash" ~ '^[a-f0-9]{64}$' AND "release_checksum" ~ '^[a-f0-9]{64}$' AND
    "plan_checksum" ~ '^[a-f0-9]{64}$' AND "materialized_checksum" ~ '^[a-f0-9]{64}$'
  )
);
CREATE UNIQUE INDEX "uq_story_authored_import_scoped_key"
  ON "story_authored_imports" ("owner_user_id", "work_id", "idempotency_key_hash");

CREATE FUNCTION story_authored_import_bindings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  work_row story_works%ROWTYPE;
  release_row story_releases%ROWTYPE;
  manuscript_row story_manuscript_versions%ROWTYPE;
BEGIN
  SELECT * INTO work_row FROM story_works WHERE id = NEW.work_id FOR UPDATE;
  SELECT * INTO release_row FROM story_releases WHERE id = NEW.release_id FOR SHARE;
  SELECT * INTO manuscript_row FROM story_manuscript_versions WHERE id = NEW.manuscript_version_id FOR SHARE;
  IF work_row.id IS NULL OR release_row.id IS NULL OR manuscript_row.id IS NULL OR
     work_row.owner_user_id <> NEW.owner_user_id OR manuscript_row.owner_user_id <> NEW.owner_user_id OR
     manuscript_row.work_id <> NEW.work_id OR release_row.work_id <> NEW.work_id OR
     release_row.manuscript_version_id <> NEW.manuscript_version_id OR
     manuscript_row.content_hash <> NEW.manuscript_content_hash OR release_row.checksum <> NEW.release_checksum THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_IMPORT_BINDING_MISMATCH';
  END IF;
  IF work_row.status NOT IN ('draft', 'intake_received', 'reviewing', 'revision_requested', 'release_ready') OR
     work_row.active_release_id IS NOT NULL OR work_row.published_at IS NOT NULL OR
     work_row.custom_choice_enabled OR release_row.status <> 'candidate' OR
     EXISTS (SELECT 1 FROM story_reader_progress WHERE work_id = NEW.work_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_PRIVATE_CANDIDATE_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM story_parts WHERE work_id = NEW.work_id) <> NEW.part_count OR
     (SELECT count(*) FROM story_scenes s JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = NEW.work_id) <> NEW.part_count OR
     (SELECT count(*) FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id
       JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = NEW.work_id) <> NEW.beat_count OR
     (SELECT count(DISTINCT b.source_scene_key) FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id
       JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = NEW.work_id) <> NEW.source_scene_count OR
     (SELECT count(*) FROM story_choices c JOIN story_scenes s ON s.id = c.scene_id
       JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = NEW.work_id) <> NEW.choice_count OR
     EXISTS (SELECT 1 FROM story_scenes s JOIN story_parts p ON p.id = s.part_id
       WHERE p.work_id = NEW.work_id AND (p.status <> 'draft' OR s.status <> 'draft' OR s.ending_type IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_MATERIALIZED_COUNTS_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_authored_import_bindings"
  BEFORE INSERT ON "story_authored_imports"
  FOR EACH ROW EXECUTE FUNCTION story_authored_import_bindings();

CREATE FUNCTION story_authored_import_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_IMPORT_IMMUTABLE';
END;
$$;
CREATE TRIGGER "story_authored_import_immutable"
  BEFORE UPDATE OR DELETE ON "story_authored_imports"
  FOR EACH ROW EXECUTE FUNCTION story_authored_import_immutable();

-- Writer submission currently pins only the manuscript, not this plan/ending.
-- Do not let a concurrent legacy transition bypass the new receipt's gate.
CREATE FUNCTION story_authored_import_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND EXISTS (
    SELECT 1 FROM story_authored_imports WHERE work_id = NEW.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_authored_import_publication_guard"
  BEFORE UPDATE OF "status", "active_release_id" ON "story_works"
  FOR EACH ROW EXECUTE FUNCTION story_authored_import_publication_guard();
