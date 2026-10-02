ALTER TABLE story_beats ADD CONSTRAINT uq_story_beats_scene_identity UNIQUE (scene_id, id);
ALTER TABLE artist_story_identity_profiles ADD CONSTRAINT uq_artist_story_identity_profiles_actor UNIQUE (id, artist_id);
CREATE TABLE story_interaction_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  work_id uuid NOT NULL,
  release_id uuid NOT NULL,
  release_checksum varchar(64) NOT NULL CHECK (release_checksum ~ '^[a-f0-9]{64}$'),
  manuscript_version_id uuid NOT NULL,
  manuscript_hash varchar(64) NOT NULL CHECK (manuscript_hash ~ '^[a-f0-9]{64}$'),
  part_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  beat_id uuid NOT NULL REFERENCES story_beats(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  identity_profile_id uuid NOT NULL REFERENCES artist_story_identity_profiles(id),
  identity_pin_hash varchar(64) NOT NULL CHECK (identity_pin_hash ~ '^[a-f0-9]{64}$'),
  locale varchar(8) NOT NULL CHECK (locale IN ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant')),
  source_checksum varchar(64) NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  interaction_kind varchar(16) NOT NULL CHECK (interaction_kind IN ('action', 'dialogue')),
  evidence_start integer NOT NULL CHECK (evidence_start BETWEEN 0 AND 64000),
  evidence_text text NOT NULL CHECK (length(btrim(evidence_text)) BETWEEN 2 AND 2000),
  memory_text text NOT NULL CHECK (length(btrim(memory_text)) BETWEEN 2 AND 400),
  approval_checksum varchar(64) NOT NULL CHECK (approval_checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'approved',
  revision integer NOT NULL DEFAULT 1,
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_story_interaction_work_owner FOREIGN KEY (work_id, owner_user_id)
    REFERENCES story_works(id, owner_user_id),
  CONSTRAINT fk_story_interaction_release FOREIGN KEY (release_id, work_id, manuscript_version_id)
    REFERENCES story_releases(id, work_id, manuscript_version_id),
  CONSTRAINT fk_story_interaction_manuscript FOREIGN KEY (manuscript_version_id, work_id, owner_user_id)
    REFERENCES story_manuscript_versions(id, work_id, owner_user_id),
  CONSTRAINT fk_story_interaction_part FOREIGN KEY (work_id, part_id) REFERENCES story_parts(work_id, id),
  CONSTRAINT fk_story_interaction_scene FOREIGN KEY (part_id, scene_id) REFERENCES story_scenes(part_id, id),
  CONSTRAINT fk_story_interaction_beat FOREIGN KEY (scene_id, beat_id) REFERENCES story_beats(scene_id, id),
  CONSTRAINT fk_story_interaction_actor FOREIGN KEY (identity_profile_id, artist_id)
    REFERENCES artist_story_identity_profiles(id, artist_id),
  CONSTRAINT ck_story_interaction_dialogue CHECK (interaction_kind <> 'dialogue' OR memory_text = evidence_text),
  CONSTRAINT ck_story_interaction_state CHECK (
    (status = 'approved' AND revision = 1 AND revoked_at IS NULL) OR
    (status = 'revoked' AND revision = 2 AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT uq_story_interaction_approval_idempotency UNIQUE (owner_user_id, work_id, idempotency_key)
);
CREATE INDEX idx_story_interaction_approval_source ON story_interaction_approvals
  (work_id, release_id, artist_id, beat_id, locale, status);
