CREATE TABLE story_author_body_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  work_id uuid NOT NULL,
  release_id uuid NOT NULL,
  progress_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  continuation_id uuid NOT NULL,
  locale varchar(8) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  source_binding_hash varchar(64) NOT NULL CHECK (source_binding_hash ~ '^[a-f0-9]{64}$'),
  binding_snapshot jsonb NOT NULL CHECK (jsonb_typeof(binding_snapshot) = 'object'),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key varchar(120) NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  decision varchar(8) NOT NULL CHECK (decision IN ('approve','reject')),
  style_reviewed boolean NOT NULL,
  characters_reviewed boolean NOT NULL,
  timeline_reviewed boolean NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_story_body_review_locale CHECK (locale IN ('ko','en','ja','zh-Hans','zh-Hant')),
  CONSTRAINT chk_story_body_review_attestation CHECK (
    (style_reviewed OR characters_reviewed OR timeline_reviewed) AND
    (decision <> 'approve' OR (style_reviewed AND characters_reviewed AND timeline_reviewed))),
  CONSTRAINT uq_story_body_review_key UNIQUE (owner_user_id,work_id,idempotency_key),
  CONSTRAINT uq_story_body_review_version UNIQUE (work_id,version),
  CONSTRAINT uq_story_body_review_owner UNIQUE (id,owner_user_id,work_id),
  CONSTRAINT fk_story_body_review_work FOREIGN KEY (work_id,owner_user_id) REFERENCES story_works(id,owner_user_id),
  CONSTRAINT fk_story_body_review_progress FOREIGN KEY (owner_user_id,work_id,progress_id)
    REFERENCES story_reader_progress(user_id,work_id,id),
  CONSTRAINT fk_story_body_review_origin FOREIGN KEY (continuation_id,owner_user_id,work_id,release_id,progress_id)
    REFERENCES story_ai_continuations(id,user_id,work_id,release_id,progress_id),
  CONSTRAINT fk_story_body_review_scene FOREIGN KEY (continuation_id,scene_id)
    REFERENCES story_ai_generated_scenes(continuation_id,id),
  CONSTRAINT fk_story_body_review_scene_progress FOREIGN KEY (progress_id,scene_id)
    REFERENCES story_ai_generated_scenes(progress_id,id)
);

CREATE TABLE story_author_body_review_withdrawals (
  review_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  work_id uuid NOT NULL,
  idempotency_key varchar(120) NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_story_body_review_withdrawal_key UNIQUE (owner_user_id,work_id,idempotency_key),
  CONSTRAINT fk_story_body_review_withdrawal_owner FOREIGN KEY (review_id,owner_user_id,work_id)
    REFERENCES story_author_body_reviews(id,owner_user_id,work_id)
);

CREATE FUNCTION story_author_body_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORY_AUTHOR_BODY_REVIEW_IMMUTABLE';
END;
$$;

CREATE TRIGGER story_author_body_review_immutable
  BEFORE UPDATE OR DELETE ON story_author_body_reviews
  FOR EACH ROW EXECUTE FUNCTION story_author_body_review_immutable();
CREATE TRIGGER story_author_body_review_withdrawal_immutable
  BEFORE UPDATE OR DELETE ON story_author_body_review_withdrawals
  FOR EACH ROW EXECUTE FUNCTION story_author_body_review_immutable();
CREATE TRIGGER story_author_body_review_truncate_guard
  BEFORE TRUNCATE ON story_author_body_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_body_review_immutable();
CREATE TRIGGER story_author_body_review_withdrawal_truncate_guard
  BEFORE TRUNCATE ON story_author_body_review_withdrawals
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_body_review_immutable();
