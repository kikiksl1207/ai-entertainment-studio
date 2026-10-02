CREATE TABLE story_branch_visual_review_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  work_id uuid NOT NULL REFERENCES story_works(id),
  shared_result_id uuid NOT NULL REFERENCES story_ai_reusable_results(id),
  release_id uuid NOT NULL REFERENCES story_releases(id),
  release_checksum varchar(64) NOT NULL CHECK (release_checksum ~ '^[a-f0-9]{64}$'),
  manuscript_version_id uuid NOT NULL REFERENCES story_manuscript_versions(id),
  manuscript_hash varchar(64) NOT NULL CHECK (manuscript_hash ~ '^[a-f0-9]{64}$'),
  source_checksum varchar(64) NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  profile_pin_hash varchar(64) NOT NULL CHECK (profile_pin_hash ~ '^[a-f0-9]{64}$'),
  prompt_text text NOT NULL CHECK (length(btrim(prompt_text)) BETWEEN 1 AND 32000),
  prompt_sha256 varchar(64) NOT NULL CHECK (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  batch_checksum varchar(64) NOT NULL CHECK (batch_checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  batch_version integer NOT NULL CHECK (batch_version > 0),
  status varchar(24) NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_story_branch_visual_review_state CHECK (
    (status = 'draft' AND revision = 1 AND approved_by_user_id IS NULL AND approved_at IS NULL) OR
    (status = 'approved' AND revision = 2 AND approved_by_user_id = owner_user_id AND
      approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT uq_story_branch_visual_review_idempotency UNIQUE (owner_user_id, work_id, idempotency_key),
  CONSTRAINT uq_story_branch_visual_review_version UNIQUE (work_id, shared_result_id, batch_version)
);
CREATE INDEX idx_story_branch_visual_review_latest ON story_branch_visual_review_batches
  (work_id, shared_result_id, batch_version);
