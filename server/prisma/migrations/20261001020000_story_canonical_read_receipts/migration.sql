ALTER TABLE story_reset_commands ADD CONSTRAINT uq_story_reset_command_reader UNIQUE (id, progress_id, user_id);
CREATE TABLE story_canonical_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  progress_id uuid NOT NULL,
  work_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  release_id uuid NOT NULL,
  release_checksum varchar(64) NOT NULL CHECK (release_checksum ~ '^[a-f0-9]{64}$'),
  manuscript_version_id uuid NOT NULL,
  manuscript_hash varchar(64) NOT NULL CHECK (manuscript_hash ~ '^[a-f0-9]{64}$'),
  part_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  beat_id uuid NOT NULL,
  beat_position integer NOT NULL CHECK (beat_position BETWEEN 1 AND 40),
  act_number integer NOT NULL CHECK (act_number > 0),
  locale varchar(8) NOT NULL CHECK (locale IN ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant')),
  source_checksum varchar(64) NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  source_text_hash varchar(64) NOT NULL CHECK (source_text_hash ~ '^[a-f0-9]{64}$'),
  route_node_id uuid NOT NULL,
  route_hash varchar(64) NOT NULL CHECK (route_hash ~ '^[a-f0-9]{64}$'),
  story_version integer NOT NULL CHECK (story_version > 0),
  progress_revision integer NOT NULL CHECK (progress_revision > 0),
  scope_checksum varchar(64) NOT NULL CHECK (scope_checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  reset_command_id uuid,
  CONSTRAINT fk_story_canonical_read_progress FOREIGN KEY (user_id, work_id, progress_id)
    REFERENCES story_reader_progress(user_id, work_id, id),
  CONSTRAINT fk_story_canonical_read_work FOREIGN KEY (work_id, owner_user_id)
    REFERENCES story_works(id, owner_user_id),
  CONSTRAINT fk_story_canonical_read_release FOREIGN KEY (release_id, work_id, manuscript_version_id)
    REFERENCES story_releases(id, work_id, manuscript_version_id),
  CONSTRAINT fk_story_canonical_read_manuscript FOREIGN KEY (manuscript_version_id, work_id, owner_user_id)
    REFERENCES story_manuscript_versions(id, work_id, owner_user_id),
  CONSTRAINT fk_story_canonical_read_part FOREIGN KEY (work_id, part_id) REFERENCES story_parts(work_id, id),
  CONSTRAINT fk_story_canonical_read_scene FOREIGN KEY (part_id, scene_id) REFERENCES story_scenes(part_id, id),
  CONSTRAINT fk_story_canonical_read_beat FOREIGN KEY (scene_id, beat_id) REFERENCES story_beats(scene_id, id),
  CONSTRAINT fk_story_canonical_read_route FOREIGN KEY (route_node_id, progress_id, work_id, release_id)
    REFERENCES story_progress_route_nodes(id, progress_id, work_id, release_id),
  CONSTRAINT fk_story_canonical_read_reset FOREIGN KEY (reset_command_id, progress_id, user_id)
    REFERENCES story_reset_commands(id, progress_id, user_id),
  CONSTRAINT ck_story_canonical_read_invalidation CHECK (
    (invalidated_at IS NULL AND reset_command_id IS NULL) OR
    (invalidated_at IS NOT NULL AND reset_command_id IS NOT NULL AND invalidated_at >= confirmed_at)
  ),
  CONSTRAINT uq_story_canonical_read_idempotency UNIQUE (user_id, progress_id, idempotency_key)
);
CREATE INDEX idx_story_canonical_read_route ON story_canonical_read_receipts
  (progress_id, route_node_id, beat_id, locale, invalidated_at);

CREATE FUNCTION guard_story_canonical_read_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Story canonical read history is append-only';
  END IF;
  IF (to_jsonb(NEW) - 'invalidated_at' - 'reset_command_id') IS DISTINCT FROM
     (to_jsonb(OLD) - 'invalidated_at' - 'reset_command_id') OR
     (OLD.invalidated_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Story canonical read source is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER story_canonical_read_receipt_guard BEFORE UPDATE OR DELETE ON story_canonical_read_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_story_canonical_read_receipt();
