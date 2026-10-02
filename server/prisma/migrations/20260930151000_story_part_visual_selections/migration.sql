CREATE TABLE story_part_visual_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  work_id uuid NOT NULL REFERENCES story_works(id),
  manuscript_version_id uuid NOT NULL REFERENCES story_manuscript_versions(id),
  manuscript_hash varchar(64) NOT NULL CHECK (manuscript_hash ~ '^[a-f0-9]{64}$'),
  source_checksum varchar(64) NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  analysis_job_id uuid NOT NULL REFERENCES story_analysis_jobs(id),
  profile_pin_hash varchar(64) NOT NULL CHECK (profile_pin_hash ~ '^[a-f0-9]{64}$'),
  part_key varchar(120) NOT NULL,
  target_scene_key varchar(160) NOT NULL,
  selection_version integer NOT NULL CHECK (selection_version > 0),
  status varchar(24) NOT NULL,
  reference_index integer,
  source_scene_key varchar(160),
  batch_id uuid REFERENCES story_scene_visual_review_batches(id),
  batch_checksum varchar(64),
  selection_checksum varchar(64) NOT NULL CHECK (selection_checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_story_part_visual_selection_target CHECK (
    part_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' AND target_scene_key = part_key || '-main'
  ),
  CONSTRAINT ck_story_part_visual_selection_state CHECK (
    (status = 'selected' AND reference_index IS NOT NULL AND reference_index BETWEEN 0 AND 1999 AND
      source_scene_key IS NOT NULL AND source_scene_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$' AND
      batch_id IS NOT NULL AND batch_checksum IS NOT NULL AND batch_checksum ~ '^[a-f0-9]{64}$') OR
    (status = 'cleared' AND reference_index IS NULL AND source_scene_key IS NULL AND batch_id IS NULL AND batch_checksum IS NULL)
  ),
  CONSTRAINT uq_story_part_visual_selection_idempotency UNIQUE (owner_user_id, work_id, idempotency_key),
  CONSTRAINT uq_story_part_visual_selection_version UNIQUE (work_id, part_key, selection_version)
);
CREATE INDEX idx_story_part_visual_selection_latest ON story_part_visual_selections (work_id, part_key, selection_version);
