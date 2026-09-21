BEGIN;

CREATE TABLE story_ai_legal_activations (
  id TEXT PRIMARY KEY,
  work_id UUID NOT NULL REFERENCES story_works(id),
  release_id UUID NOT NULL,
  release_checksum TEXT NOT NULL,
  manuscript_version_id UUID NOT NULL,
  rights_contract_version_id UUID NOT NULL REFERENCES content_rights_contract_versions(id),
  consent_id UUID NOT NULL,
  consent_revision INTEGER NOT NULL CHECK (consent_revision > 0),
  locale TEXT NOT NULL CHECK (locale IN ('ko','en','ja','zh-Hans','zh-Hant')),
  region TEXT NOT NULL CHECK (region ~ '^[A-Z]{2}$'),
  moderation_policy_version TEXT NOT NULL CHECK (moderation_policy_version ~ '^[A-Za-z0-9._-]{1,100}$'),
  moderation_evidence_version TEXT NOT NULL CHECK (moderation_evidence_version ~ '^[A-Za-z0-9._-]{1,100}$'),
  quality_policy_version TEXT NOT NULL CHECK (quality_policy_version = 'story-ai-quality-admin-v1'),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  starts_at TIMESTAMPTZ(6) NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL CHECK (expires_at > starts_at),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_id,release_id) REFERENCES story_releases(work_id,id),
  FOREIGN KEY (work_id,manuscript_version_id) REFERENCES story_manuscript_versions(work_id,id),
  FOREIGN KEY (work_id,consent_id) REFERENCES story_style_profile_consents(work_id,id)
);
CREATE INDEX idx_story_ai_activation_scope ON story_ai_legal_activations(release_id,locale,region,created_at);
CREATE TABLE story_ai_activation_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id TEXT NOT NULL UNIQUE REFERENCES story_ai_legal_activations(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE story_ai_generated_scenes ADD CONSTRAINT uq_story_ai_generated_scenes_evidence_owner
  UNIQUE (id,work_id,release_id,result_checksum);
ALTER TABLE story_ai_reusable_results
  ADD COLUMN origin_generated_scene_id UUID UNIQUE,
  ADD COLUMN review_pending_at TIMESTAMPTZ(6),
  ADD CONSTRAINT story_ai_reusable_result_origin_fk
    FOREIGN KEY (origin_generated_scene_id,work_id,release_id,result_checksum)
    REFERENCES story_ai_generated_scenes(id,work_id,release_id,result_checksum),
  ADD CONSTRAINT story_ai_reusable_result_review_tuple CHECK (
    num_nonnulls(origin_generated_scene_id,review_pending_at) IN (0,2)),
  DROP CONSTRAINT story_ai_reusable_results_lifecycle_check,
  ADD CONSTRAINT story_ai_reusable_results_lifecycle_check CHECK (
    (status='pending' AND title IS NULL AND visual_manifest IS NULL AND approved_at IS NULL
      AND revoked_at IS NULL AND revoke_reason IS NULL
      AND ((origin_generated_scene_id IS NULL AND result_checksum IS NULL)
        OR (origin_generated_scene_id IS NOT NULL AND result_checksum IS NOT NULL AND claim_token IS NULL)))
    OR (status='approved' AND claim_token IS NULL AND result_checksum IS NOT NULL AND title IS NOT NULL
      AND visual_manifest IS NOT NULL AND approved_at IS NOT NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='revoked' AND claim_token IS NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  );

CREATE TABLE story_ai_result_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_result_id UUID NOT NULL REFERENCES story_ai_reusable_results(id),
  origin_generated_scene_id UUID NOT NULL REFERENCES story_ai_generated_scenes(id),
  result_checksum TEXT NOT NULL CHECK (result_checksum ~ '^[a-f0-9]{64}$'),
  kind TEXT NOT NULL CHECK (kind IN ('moderation','quality')),
  decision TEXT NOT NULL CHECK (decision IN ('allow','reject','revoke')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_id UUID UNIQUE REFERENCES story_ai_result_evidence(id),
  policy_version TEXT NOT NULL CHECK (policy_version ~ '^[A-Za-z0-9._-]{1,100}$'),
  evaluator_version TEXT NOT NULL CHECK (evaluator_version ~ '^[A-Za-z0-9._-]{1,100}$'),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(shared_result_id,kind,revision)
);

CREATE FUNCTION story_ai_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'story AI evidence is append-only'; END $$;
CREATE TRIGGER story_ai_activation_immutable BEFORE UPDATE OR DELETE ON story_ai_legal_activations
  FOR EACH ROW EXECUTE FUNCTION story_ai_append_only();
CREATE TRIGGER story_ai_activation_revocation_immutable BEFORE UPDATE OR DELETE ON story_ai_activation_revocations
  FOR EACH ROW EXECUTE FUNCTION story_ai_append_only();
CREATE TRIGGER story_ai_evidence_immutable BEFORE UPDATE OR DELETE ON story_ai_result_evidence
  FOR EACH ROW EXECUTE FUNCTION story_ai_append_only();

-- This is a live predicate, never a configuration flag or an approval cached in memory.
CREATE FUNCTION story_ai_activation_valid(activation_key TEXT, requested_locale TEXT, requested_region TEXT, require_reuse BOOLEAN DEFAULT true)
RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
  SELECT EXISTS (
    SELECT 1 FROM story_ai_legal_activations a
    JOIN story_releases r ON r.id=a.release_id AND r.work_id=a.work_id
    JOIN story_works w ON w.id=a.work_id
    JOIN story_manuscript_versions m ON m.id=a.manuscript_version_id AND m.work_id=a.work_id
    JOIN story_style_profile_consents c ON c.id=a.consent_id AND c.work_id=a.work_id
    JOIN content_rights_contract_versions v ON v.id=a.rights_contract_version_id
    JOIN content_rights_contracts contract ON contract.id=v.contract_id
    WHERE a.id=activation_key AND a.locale=requested_locale AND a.region=requested_region
      AND a.starts_at<=clock_timestamp() AND a.expires_at>clock_timestamp()
      AND r.checksum=a.release_checksum AND r.manuscript_version_id=a.manuscript_version_id
      AND r.status='active' AND w.active_release_id=r.id AND w.status='published'
      AND m.owner_user_id=w.owner_user_id AND c.owner_user_id=w.owner_user_id
      AND c.manuscript_version_id=a.manuscript_version_id AND c.revision=a.consent_revision
      AND c.status='active' AND c.rights_confirmed AND c.ai_branch_allowed
      AND c.starts_at<=clock_timestamp() AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())
      AND c.allowed_locales ? a.locale AND (c.allowed_regions ? a.region OR c.allowed_regions ? 'worldwide')
      AND c.withdrawn_at IS NULL AND c.deletion_requested_at IS NULL AND c.deleted_at IS NULL
      AND contract.work_type='story' AND contract.work_id=a.work_id
      AND v.content_version_id=a.manuscript_version_id AND v.approval_state='approved_configuration'
      AND v.ai_transformation_allowed AND (NOT require_reuse OR v.generated_result_reuse_allowed)
      AND (v.media ? 'story' OR v.media ? 'story_publication' OR v.media ? 'all')
      AND (v.regions ? a.region OR v.regions ? 'worldwide')
      AND v.starts_at<=clock_timestamp() AND v.effective_from<=clock_timestamp()
      AND (v.ends_at IS NULL OR v.ends_at>clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM content_rights_contract_versions newer
        WHERE newer.contract_id=v.contract_id AND newer.revision>v.revision
          AND newer.approval_state='approved_configuration' AND newer.effective_from<=clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM story_ai_activation_revocations x WHERE x.activation_id=a.id)
  );
$$;

CREATE FUNCTION story_ai_evidence_valid(result_id UUID, checksum TEXT, evidence_kind TEXT,
  policy TEXT, evaluator TEXT) RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
  SELECT COALESCE((SELECT e.decision='allow' AND e.result_checksum=checksum
    AND e.policy_version=policy AND e.evaluator_version=evaluator AND e.expires_at>clock_timestamp()
    FROM story_ai_result_evidence e WHERE e.shared_result_id=result_id AND e.kind=evidence_kind
    ORDER BY e.revision DESC LIMIT 1),false);
$$;

CREATE FUNCTION guard_story_ai_activation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM story_releases r
    JOIN content_rights_contract_versions v ON v.id=NEW.rights_contract_version_id
    JOIN content_rights_contracts c ON c.id=v.contract_id
    JOIN story_style_profile_consents s ON s.id=NEW.consent_id
    JOIN story_works w ON w.id=r.work_id
    WHERE r.id=NEW.release_id AND r.work_id=NEW.work_id
      AND r.checksum=NEW.release_checksum AND r.manuscript_version_id=NEW.manuscript_version_id
      AND c.work_type='story' AND c.work_id=NEW.work_id AND v.content_version_id=NEW.manuscript_version_id
      AND s.work_id=NEW.work_id AND s.manuscript_version_id=NEW.manuscript_version_id
      AND s.owner_user_id=w.owner_user_id AND s.revision=NEW.consent_revision) THEN
    RAISE EXCEPTION 'story AI activation owner or version mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_activation_insert BEFORE INSERT ON story_ai_legal_activations
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_activation_insert();

CREATE FUNCTION guard_story_ai_evidence_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r story_ai_reusable_results; previous story_ai_result_evidence;
BEGIN
  SELECT * INTO r FROM story_ai_reusable_results WHERE id=NEW.shared_result_id FOR UPDATE;
  IF r.origin_generated_scene_id IS DISTINCT FROM NEW.origin_generated_scene_id
    OR r.result_checksum IS DISTINCT FROM NEW.result_checksum OR r.status='revoked' THEN
    RAISE EXCEPTION 'story AI evidence origin or checksum mismatch';
  END IF;
  SELECT * INTO previous FROM story_ai_result_evidence WHERE shared_result_id=NEW.shared_result_id
    AND kind=NEW.kind ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.supersedes_id IS DISTINCT FROM previous.id THEN
    RAISE EXCEPTION 'story AI evidence revision mismatch';
  END IF;
  IF NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'story AI evidence already expired'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_evidence_insert BEFORE INSERT ON story_ai_result_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_evidence_insert();

CREATE FUNCTION guard_story_ai_result_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a story_ai_legal_activations;
BEGIN
  IF TG_OP='INSERT' AND NEW.origin_generated_scene_id IS NOT NULL THEN
    RAISE EXCEPTION 'story AI result must be generated before review';
  END IF;
  IF TG_OP='UPDATE' AND OLD.origin_generated_scene_id IS NOT NULL AND (
    NEW.origin_generated_scene_id IS DISTINCT FROM OLD.origin_generated_scene_id
    OR NEW.review_pending_at IS DISTINCT FROM OLD.review_pending_at
    OR NEW.ending_key IS DISTINCT FROM OLD.ending_key
    OR NEW.result_checksum IS DISTINCT FROM OLD.result_checksum) THEN
    RAISE EXCEPTION 'story AI review origin is immutable';
  END IF;
  IF NEW.origin_generated_scene_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM story_ai_generated_scenes s JOIN story_ai_continuations c ON c.id=s.continuation_id
    WHERE s.id=NEW.origin_generated_scene_id AND s.work_id=NEW.work_id AND s.release_id=NEW.release_id
      AND s.result_checksum=NEW.result_checksum AND s.provenance='ai_generated'
      AND c.shared_result_id=NEW.id AND c.reuse_key=NEW.reuse_key AND c.request_kind='recommended_choice'
  ) THEN RAISE EXCEPTION 'story AI review requires owned private origin'; END IF;
  IF NEW.status='approved' THEN
    SELECT * INTO a FROM story_ai_legal_activations WHERE id=NEW.rights_activation_key FOR SHARE;
    PERFORM 1 FROM story_style_profile_consents WHERE id=a.consent_id FOR SHARE;
    IF a.id IS NULL OR a.work_id<>NEW.work_id OR a.release_id<>NEW.release_id
      OR a.release_checksum<>NEW.release_checksum OR a.manuscript_version_id<>NEW.manuscript_version_id
      OR NOT story_ai_activation_valid(a.id,NEW.locale,a.region)
      OR a.moderation_policy_version<>NEW.moderation_policy_version
      OR a.moderation_evidence_version<>NEW.moderation_evidence_version
      OR a.quality_policy_version<>NEW.quality_policy_version
      OR NEW.origin_generated_scene_id IS NULL
      OR NOT story_ai_evidence_valid(NEW.id,NEW.result_checksum,'moderation',NEW.moderation_policy_version,NEW.moderation_evidence_version)
      OR NOT story_ai_evidence_valid(NEW.id,NEW.result_checksum,'quality',NEW.quality_policy_version,'explicit-admin-v1') THEN
      RAISE EXCEPTION 'story AI approval requires active legal moderation quality evidence';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM story_ai_generated_scenes s
      JOIN story_ai_continuations c ON c.id=s.continuation_id
      WHERE s.id=NEW.origin_generated_scene_id AND s.status='ready' AND c.status='completed'
        AND s.title=NEW.title AND s.visual_manifest=NEW.visual_manifest)
      OR EXISTS ((SELECT position,beat_type,content FROM story_ai_reusable_beats WHERE shared_result_id=NEW.id)
        EXCEPT (SELECT position,beat_type,content FROM story_ai_generated_beats WHERE scene_id=NEW.origin_generated_scene_id))
      OR EXISTS ((SELECT position,beat_type,content FROM story_ai_generated_beats WHERE scene_id=NEW.origin_generated_scene_id)
        EXCEPT (SELECT position,beat_type,content FROM story_ai_reusable_beats WHERE shared_result_id=NEW.id))
      OR EXISTS ((SELECT position,choice_key,label FROM story_ai_reusable_choices WHERE shared_result_id=NEW.id)
        EXCEPT (SELECT position,choice_key,label FROM story_ai_generated_choices WHERE scene_id=NEW.origin_generated_scene_id))
      OR EXISTS ((SELECT position,choice_key,label FROM story_ai_generated_choices WHERE scene_id=NEW.origin_generated_scene_id)
        EXCEPT (SELECT position,choice_key,label FROM story_ai_reusable_choices WHERE shared_result_id=NEW.id)) THEN
      RAISE EXCEPTION 'story AI promotion must copy exact private output';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_reusable_results_evidence_guard BEFORE INSERT OR UPDATE ON story_ai_reusable_results
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_result_evidence();

CREATE FUNCTION guard_story_ai_activation_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM story_ai_legal_activations WHERE id=NEW.activation_id FOR UPDATE;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_activation_revoke BEFORE INSERT ON story_ai_activation_revocations
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_activation_revoke();

COMMIT;
