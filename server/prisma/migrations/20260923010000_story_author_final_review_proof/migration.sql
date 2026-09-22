-- Receipt hashes remain immutable. This digest excludes only controlled lifecycle
-- status/timestamps, retaining authored identity, text, order, price and visuals.
CREATE FUNCTION story_author_content_checksum(work_uuid UUID) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT encode(digest(convert_to(jsonb_build_object(
    'version', 'authored-content-v1',
    'parts', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM (
      SELECT id, season_key, act_number, position, title, price_lumina, fixture_source
      FROM story_parts WHERE work_id = work_uuid) p), '[]'::jsonb),
    'scenes', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM (
      SELECT s.id, s.part_id, s.scene_key, s.position, s.title, s.visual_manifest, s.ending_type, s.fixture_source
      FROM story_scenes s JOIN story_parts p ON p.id = s.part_id WHERE p.work_id = work_uuid) s), '[]'::jsonb),
    'beats', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM (
      SELECT b.id, b.scene_id, b.position, b.beat_type, b.content, b.source_scene_key, b.visual_manifest
      FROM story_beats b JOIN story_scenes s ON s.id = b.scene_id JOIN story_parts p ON p.id = s.part_id
      WHERE p.work_id = work_uuid) b), '[]'::jsonb),
    'choices', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM (
      SELECT c.id, c.scene_id, c.choice_key, c.position, c.label, c.route_kind,
        c.target_scene_id, c.target_ending_key, c.declared_rejoin_scene_id
      FROM story_choices c JOIN story_scenes s ON s.id = c.scene_id JOIN story_parts p ON p.id = s.part_id
      WHERE p.work_id = work_uuid) c), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE FUNCTION story_author_review_snapshot_hash(value JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex'); $$;

CREATE UNIQUE INDEX uq_story_writer_review_author_binding
  ON story_writer_reviews (id, work_id, owner_user_id, manuscript_version_id);
CREATE UNIQUE INDEX uq_story_final_submission_review_binding
  ON story_final_submissions (id, review_id, manuscript_version_id);
CREATE UNIQUE INDEX uq_story_authored_import_proof_binding
  ON story_authored_imports (id, work_id, owner_user_id, manuscript_version_id, release_id);

CREATE TABLE story_author_final_review_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  final_submission_id UUID NOT NULL UNIQUE,
  review_id UUID NOT NULL UNIQUE,
  review_revision INTEGER NOT NULL CHECK (review_revision > 0),
  owner_user_id UUID NOT NULL,
  work_id UUID NOT NULL,
  manuscript_version_id UUID NOT NULL,
  release_id UUID NOT NULL UNIQUE,
  authored_import_id UUID NOT NULL UNIQUE,
  contract_version TEXT NOT NULL CHECK (contract_version = 'author-final-review-v1'),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[a-f0-9]{64}$'),
  content_checksum TEXT NOT NULL CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  anchor_scope BOOLEAN NOT NULL,
  binding_snapshot JSONB NOT NULL CHECK (jsonb_typeof(binding_snapshot) = 'object' AND octet_length(binding_snapshot::text) <= 2097152),
  proof_hash TEXT NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id, work_id, owner_user_id, manuscript_version_id)
    REFERENCES story_writer_reviews (id, work_id, owner_user_id, manuscript_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (final_submission_id, review_id, manuscript_version_id)
    REFERENCES story_final_submissions (id, review_id, manuscript_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (authored_import_id, work_id, owner_user_id, manuscript_version_id, release_id)
    REFERENCES story_authored_imports (id, work_id, owner_user_id, manuscript_version_id, release_id) ON DELETE RESTRICT
);

CREATE INDEX idx_story_author_final_review_work ON story_author_final_review_proofs(work_id);

CREATE TABLE story_author_final_review_revocations (
  proof_id UUID PRIMARY KEY REFERENCES story_author_final_review_proofs(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('author_withdrawn', 'binding_invalid')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION story_author_final_review_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r story_writer_reviews%ROWTYPE; f story_final_submissions%ROWTYPE;
  i story_authored_imports%ROWTYPE; w story_works%ROWTYPE; rel story_releases%ROWTYPE;
BEGIN
  SELECT * INTO w FROM story_works WHERE id = NEW.work_id FOR UPDATE;
  SELECT * INTO r FROM story_writer_reviews WHERE id = NEW.review_id FOR UPDATE;
  SELECT * INTO f FROM story_final_submissions WHERE id = NEW.final_submission_id FOR SHARE;
  SELECT * INTO i FROM story_authored_imports WHERE id = NEW.authored_import_id FOR SHARE;
  SELECT * INTO rel FROM story_releases WHERE id = NEW.release_id FOR SHARE;
  IF w.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR r.revision IS DISTINCT FROM NEW.review_revision OR
     r.state NOT IN ('final_confirmation', 'submission_failed') OR f.checksum IS DISTINCT FROM i.manuscript_content_hash OR
     f.created_at IS DISTINCT FROM CURRENT_TIMESTAMP OR rel.status IS DISTINCT FROM 'candidate' OR
     w.active_release_id IS NOT NULL OR w.published_at IS NOT NULL OR
     NEW.content_checksum IS DISTINCT FROM story_author_content_checksum(NEW.work_id) OR
     NEW.proposal_hash IS DISTINCT FROM story_author_review_snapshot_hash(NEW.binding_snapshot) OR
     NEW.proof_hash IS DISTINCT FROM story_author_review_snapshot_hash(jsonb_build_object(
       'proofId', NEW.id, 'finalSubmissionId', NEW.final_submission_id, 'proposalHash', NEW.proposal_hash)) OR
     NEW.binding_snapshot->>'version' IS DISTINCT FROM NEW.contract_version OR
     NEW.binding_snapshot->>'reviewId' IS DISTINCT FROM NEW.review_id::text OR
     NEW.binding_snapshot->>'reviewRevision' IS DISTINCT FROM NEW.review_revision::text OR
     NEW.binding_snapshot->>'ownerUserId' IS DISTINCT FROM NEW.owner_user_id::text OR
     NEW.binding_snapshot->>'workId' IS DISTINCT FROM NEW.work_id::text OR
     NEW.binding_snapshot->>'releaseId' IS DISTINCT FROM NEW.release_id::text OR
     NEW.binding_snapshot->>'receiptId' IS DISTINCT FROM NEW.authored_import_id::text OR
     NEW.binding_snapshot->>'manuscriptVersionId' IS DISTINCT FROM NEW.manuscript_version_id::text OR
     NEW.binding_snapshot->>'manuscriptContentHash' IS DISTINCT FROM i.manuscript_content_hash OR
     NEW.binding_snapshot->>'releaseChecksum' IS DISTINCT FROM i.release_checksum OR
     NEW.binding_snapshot->>'sourceMapSha256' IS DISTINCT FROM i.source_map_sha256 OR
     NEW.binding_snapshot->>'planChecksum' IS DISTINCT FROM i.plan_checksum OR
     NEW.binding_snapshot->>'draftMaterializedChecksum' IS DISTINCT FROM i.materialized_checksum OR
     NEW.binding_snapshot->>'contentChecksum' IS DISTINCT FROM NEW.content_checksum OR
     NEW.binding_snapshot->'endingResolution' IS DISTINCT FROM i.ending_resolution OR
     NEW.binding_snapshot->'reviewedScopes' IS DISTINCT FROM (CASE WHEN NEW.anchor_scope
       THEN '["authored_publication","continuation_anchor"]'::jsonb ELSE '["authored_publication"]'::jsonb END) OR
     (NEW.anchor_scope AND (NEW.binding_snapshot->'anchorPolicy' IS NULL OR NEW.binding_snapshot->'anchorPolicy' = 'null'::jsonb)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHOR_FINAL_REVIEW_BINDING_INVALID';
  END IF;
  -- Publish an MVCC barrier with the proof. A pre-approval repeatable-read writer
  -- must serialize-fail on its work lock, not miss this newly committed proof.
  UPDATE story_works SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.work_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER story_author_final_review_binding BEFORE INSERT ON story_author_final_review_proofs
  FOR EACH ROW EXECUTE FUNCTION story_author_final_review_binding();

CREATE FUNCTION story_author_final_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHOR_FINAL_REVIEW_IMMUTABLE'; END; $$;
CREATE TRIGGER story_author_final_review_immutable BEFORE UPDATE OR DELETE ON story_author_final_review_proofs
  FOR EACH ROW EXECUTE FUNCTION story_author_final_review_immutable();
CREATE TRIGGER story_author_final_review_revocation_immutable BEFORE UPDATE OR DELETE ON story_author_final_review_revocations
  FOR EACH ROW EXECUTE FUNCTION story_author_final_review_immutable();

CREATE FUNCTION story_author_row_work(table_name TEXT, row_data JSONB) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE result UUID;
BEGIN
  IF row_data IS NULL THEN RETURN NULL; END IF;
  CASE table_name
    WHEN 'story_parts' THEN result := (row_data->>'work_id')::uuid;
    WHEN 'story_scenes' THEN
      SELECT work_id INTO result FROM story_parts WHERE id = (row_data->>'part_id')::uuid;
    WHEN 'story_beats', 'story_choices' THEN
      SELECT p.work_id INTO result FROM story_parts p JOIN story_scenes s ON s.part_id = p.id
        WHERE s.id = (row_data->>'scene_id')::uuid;
    ELSE RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHOR_CONTENT_TABLE_UNSUPPORTED';
  END CASE;
  RETURN result;
END; $$;

CREATE FUNCTION story_author_approved_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_data JSONB; new_data JSONB; old_work UUID; new_work UUID; locked_id UUID;
  scene_ids UUID[] := ARRAY[]::uuid[]; part_ids UUID[] := ARRAY[]::uuid[];
  ignored_columns TEXT[];
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  old_work := story_author_row_work(TG_TABLE_NAME, old_data);
  new_work := story_author_row_work(TG_TABLE_NAME, new_data);

  -- Application mutations take work first. A direct UPDATE may already hold a
  -- child row lock before this trigger; NOWAIT avoids an inverse-order wait.
  FOR locked_id IN SELECT DISTINCT id FROM unnest(ARRAY[old_work, new_work]) AS roots(id)
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM story_works WHERE id = locked_id FOR UPDATE NOWAIT;
  END LOOP;

  IF TG_TABLE_NAME = 'story_scenes' THEN
    part_ids := ARRAY[(old_data->>'part_id')::uuid, (new_data->>'part_id')::uuid];
  ELSIF TG_TABLE_NAME IN ('story_beats', 'story_choices') THEN
    scene_ids := ARRAY[(old_data->>'scene_id')::uuid, (new_data->>'scene_id')::uuid];
    SELECT COALESCE(array_agg(DISTINCT part_id), ARRAY[]::uuid[]) INTO part_ids
      FROM story_scenes WHERE id = ANY(scene_ids);
  END IF;
  -- Also lock ancestors: a stale snapshot must not follow an earlier parent
  -- membership after another transaction has moved it into a protected work.
  FOR locked_id IN SELECT DISTINCT id FROM unnest(part_ids) AS parents(id)
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM story_parts WHERE id = locked_id FOR SHARE NOWAIT;
  END LOOP;
  FOR locked_id IN SELECT DISTINCT id FROM unnest(scene_ids) AS parents(id)
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM story_scenes WHERE id = locked_id FOR SHARE NOWAIT;
  END LOOP;
  IF old_work IS DISTINCT FROM story_author_row_work(TG_TABLE_NAME, old_data) OR
     new_work IS DISTINCT FROM story_author_row_work(TG_TABLE_NAME, new_data) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'AUTHOR_CONTENT_SCOPE_CHANGED';
  END IF;

  IF EXISTS (SELECT 1 FROM story_author_final_review_proofs WHERE work_id IN (old_work, new_work)) THEN
    ignored_columns := CASE TG_TABLE_NAME
      WHEN 'story_parts' THEN ARRAY['status', 'published_at', 'updated_at']
      WHEN 'story_scenes' THEN ARRAY['status', 'updated_at']
      ELSE ARRAY[]::text[] END;
    IF TG_OP <> 'UPDATE' OR (old_data - ignored_columns) IS DISTINCT FROM (new_data - ignored_columns) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHOR_APPROVED_CONTENT_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER story_author_approved_parts BEFORE INSERT OR UPDATE OR DELETE ON story_parts
  FOR EACH ROW EXECUTE FUNCTION story_author_approved_content_guard();
CREATE TRIGGER story_author_approved_scenes BEFORE INSERT OR UPDATE OR DELETE ON story_scenes
  FOR EACH ROW EXECUTE FUNCTION story_author_approved_content_guard();
CREATE TRIGGER story_author_approved_beats BEFORE INSERT OR UPDATE OR DELETE ON story_beats
  FOR EACH ROW EXECUTE FUNCTION story_author_approved_content_guard();
CREATE TRIGGER story_author_approved_choices BEFORE INSERT OR UPDATE OR DELETE ON story_choices
  FOR EACH ROW EXECUTE FUNCTION story_author_approved_content_guard();

CREATE FUNCTION story_author_approved_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- TRUNCATE has no row scope and is not MVCC-safe for older snapshots. Require
  -- scoped DML instead; checking only snapshot-visible proof rows could miss one.
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHOR_CANONICAL_TRUNCATE_UNSUPPORTED';
END; $$;
CREATE TRIGGER story_author_approved_parts_truncate BEFORE TRUNCATE ON story_parts
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_approved_truncate_guard();
CREATE TRIGGER story_author_approved_scenes_truncate BEFORE TRUNCATE ON story_scenes
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_approved_truncate_guard();
CREATE TRIGGER story_author_approved_beats_truncate BEFORE TRUNCATE ON story_beats
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_approved_truncate_guard();
CREATE TRIGGER story_author_approved_choices_truncate BEFORE TRUNCATE ON story_choices
  FOR EACH STATEMENT EXECUTE FUNCTION story_author_approved_truncate_guard();

CREATE OR REPLACE FUNCTION story_authored_import_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p story_author_final_review_proofs%ROWTYPE; i story_authored_imports%ROWTYPE;
BEGIN
  SELECT * INTO i FROM story_authored_imports WHERE work_id = NEW.id;
  IF NEW.status = 'published' AND i.id IS NOT NULL THEN
    SELECT * INTO p FROM story_author_final_review_proofs WHERE authored_import_id = i.id;
    IF p.id IS NULL OR p.release_id IS DISTINCT FROM NEW.active_release_id OR p.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR
       EXISTS (SELECT 1 FROM story_author_final_review_revocations WHERE proof_id = p.id) OR
       p.content_checksum IS DISTINCT FROM story_author_content_checksum(NEW.id) OR
       NOT EXISTS (SELECT 1 FROM story_releases r JOIN story_manuscript_versions m ON m.id = r.manuscript_version_id
         WHERE r.id = p.release_id AND r.status = 'active' AND r.checksum = i.release_checksum
           AND m.content_hash = i.manuscript_content_hash AND m.owner_user_id = NEW.owner_user_id) OR
       EXISTS (SELECT 1 FROM story_parts WHERE work_id = NEW.id AND (status <> 'published' OR fixture_source)) OR
       EXISTS (SELECT 1 FROM story_scenes s JOIN story_parts part ON part.id = s.part_id
         WHERE part.work_id = NEW.id AND (s.status <> 'published' OR s.fixture_source)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
