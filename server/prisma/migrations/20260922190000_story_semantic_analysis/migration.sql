BEGIN;
ALTER TABLE story_analysis_jobs
  ADD COLUMN pipeline text NOT NULL DEFAULT 'structural_legacy',
  ADD COLUMN actor_user_id uuid REFERENCES users(id),
  ADD COLUMN source_content_hash text,
  ADD COLUMN source_locale text,
  ADD COLUMN rate_card_id uuid REFERENCES story_ai_rate_cards(id),
  ADD COLUMN source_digest text,
  ADD COLUMN config_pins jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN config_hash text,
  ADD COLUMN phase text NOT NULL DEFAULT 'legacy',
  ADD COLUMN plan_cursor jsonb NOT NULL DEFAULT '{"part":0,"paragraph":0,"offset":0}',
  ADD COLUMN total_paragraphs integer NOT NULL DEFAULT 0,
  ADD COLUMN total_parts integer NOT NULL DEFAULT 0,
  ADD COLUMN planned_chunks integer NOT NULL DEFAULT 0,
  ADD COLUMN completed_chunks integer NOT NULL DEFAULT 0,
  ADD COLUMN planned_paragraphs integer NOT NULL DEFAULT 0,
  ADD COLUMN completed_paragraphs integer NOT NULL DEFAULT 0,
  ADD COLUMN reserved_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN reserved_output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN reserved_cost_krw numeric(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN observed_cost_krw numeric(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN actual_cost_krw numeric(18,6),
  ADD COLUMN lease_token text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN final_cursor uuid,
  ADD CONSTRAINT story_analysis_source_work_fk FOREIGN KEY(work_id, manuscript_version_id)
    REFERENCES story_manuscript_versions(work_id,id),
  ADD CONSTRAINT story_semantic_job_bounds CHECK (
    total_paragraphs >= 0 AND total_parts >= 0 AND planned_chunks >= 0 AND
    completed_chunks BETWEEN 0 AND planned_chunks AND
    planned_paragraphs BETWEEN 0 AND total_paragraphs AND
    completed_paragraphs BETWEEN 0 AND planned_paragraphs AND
    reserved_input_tokens >= 0 AND reserved_output_tokens >= 0 AND
    reserved_cost_krw >= 0 AND observed_cost_krw >= 0 AND actual_cost_krw >= 0),
  ADD CONSTRAINT story_semantic_job_pins CHECK (pipeline <> 'semantic_extraction_v1' OR
    (actor_user_id IS NOT NULL AND rate_card_id IS NOT NULL AND source_content_hash IS NOT NULL AND source_locale IS NOT NULL AND source_digest IS NOT NULL AND config_hash IS NOT NULL));

CREATE UNIQUE INDEX story_manuscript_analysis_owner_key ON story_manuscript_versions(id,work_id,owner_user_id);
ALTER TABLE story_analysis_jobs ADD CONSTRAINT story_analysis_source_owner_fk
  FOREIGN KEY(manuscript_version_id,work_id,actor_user_id) REFERENCES story_manuscript_versions(id,work_id,owner_user_id);

-- One immutable extraction run per version. A new HTTP key must not restart a
-- failed/unknown paid run; explicit reconciliation requires a later workflow.
CREATE UNIQUE INDEX story_semantic_one_run_per_version ON story_analysis_jobs(manuscript_version_id)
  WHERE pipeline = 'semantic_extraction_v1';
CREATE INDEX story_semantic_claim ON story_analysis_jobs(created_at,id)
  WHERE pipeline = 'semantic_extraction_v1' AND status IN ('queued','running');

CREATE TABLE story_analysis_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_job_id uuid NOT NULL REFERENCES story_analysis_jobs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK(ordinal >= 0),
  source_refs jsonb NOT NULL,
  source_hash text NOT NULL,
  paragraph_count integer NOT NULL CHECK(paragraph_count >= 0),
  input_token_budget integer NOT NULL CHECK(input_token_budget > 0),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  dispatch_started_at timestamptz,
  input_tokens integer CHECK(input_tokens >= 0),
  output_tokens integer CHECK(output_tokens >= 0),
  cached_input_tokens integer CHECK(cached_input_tokens BETWEEN 0 AND input_tokens),
  reasoning_tokens integer CHECK(reasoning_tokens BETWEEN 0 AND output_tokens),
  actual_cost_krw numeric(18,6) CHECK(actual_cost_krw >= 0),
  error_code text,
  completed_at timestamptz,
  UNIQUE(analysis_job_id,ordinal), UNIQUE(analysis_job_id,id)
);
CREATE INDEX story_analysis_chunks_job_status ON story_analysis_chunks(analysis_job_id,status,ordinal);
ALTER TABLE story_analysis_evidence
  ADD COLUMN chunk_id uuid,
  ADD COLUMN provenance text NOT NULL DEFAULT 'structural_legacy',
  ADD COLUMN evidence_sequence integer CHECK(evidence_sequence >= 0),
  ADD CONSTRAINT story_analysis_evidence_chunk_fk FOREIGN KEY(analysis_job_id,chunk_id)
    REFERENCES story_analysis_chunks(analysis_job_id,id);
CREATE UNIQUE INDEX story_analysis_evidence_sequence_key ON story_analysis_evidence(analysis_job_id,evidence_sequence);

CREATE FUNCTION guard_semantic_analysis_pins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pipeline='semantic_extraction_v1' THEN
    IF (NEW.work_id,NEW.manuscript_version_id,NEW.actor_user_id,NEW.pipeline,NEW.config_pins,NEW.config_hash,
      NEW.source_content_hash,NEW.source_locale,NEW.rate_card_id)
      IS DISTINCT FROM (OLD.work_id,OLD.manuscript_version_id,OLD.actor_user_id,OLD.pipeline,OLD.config_pins,OLD.config_hash,
      OLD.source_content_hash,OLD.source_locale,OLD.rate_card_id)
      OR NEW.reserved_input_tokens<OLD.reserved_input_tokens OR NEW.reserved_output_tokens<OLD.reserved_output_tokens
      OR NEW.reserved_cost_krw<OLD.reserved_cost_krw
      OR (OLD.phase<>'initializing' AND NEW.source_digest IS DISTINCT FROM OLD.source_digest)
    THEN RAISE EXCEPTION 'Semantic pins and reservations are immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_semantic_analysis_pins BEFORE UPDATE ON story_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_semantic_analysis_pins();

CREATE FUNCTION guard_semantic_analysis_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job story_analysis_jobs;
BEGIN
  IF (NEW.analysis_job_id,NEW.ordinal,NEW.source_refs,NEW.source_hash,NEW.paragraph_count,NEW.input_token_budget)
    IS DISTINCT FROM (OLD.analysis_job_id,OLD.ordinal,OLD.source_refs,OLD.source_hash,OLD.paragraph_count,OLD.input_token_budget)
  THEN RAISE EXCEPTION 'Semantic chunk source is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.dispatch_started_at IS NULL AND NEW.dispatch_started_at IS NOT NULL THEN
    SELECT * INTO STRICT job FROM story_analysis_jobs WHERE id=NEW.analysis_job_id;
    IF (job.pipeline='semantic_extraction_v1' AND job.phase='extracting' AND job.status='running'
      AND job.lease_token IS NOT NULL AND job.lease_expires_at>clock_timestamp()
      AND job.planned_chunks>=1 AND job.total_paragraphs>0 AND job.planned_paragraphs=job.total_paragraphs
      AND job.reserved_input_tokens<=(job.config_pins->>'maxJobInputTokens')::integer
      AND job.reserved_output_tokens<=(job.config_pins->>'maxJobOutputTokens')::integer
      AND job.reserved_output_tokens=job.planned_chunks*(job.config_pins->>'outputTokenLimit')::integer
      AND job.reserved_cost_krw<=(job.config_pins->>'maxJobCostKrw')::numeric) IS NOT TRUE
    THEN RAISE EXCEPTION 'Semantic dispatch lacks a complete bounded reservation' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_semantic_analysis_dispatch BEFORE UPDATE ON story_analysis_chunks
  FOR EACH ROW EXECUTE FUNCTION guard_semantic_analysis_dispatch();

-- The worker can cache one source safely; analyzed versions cannot be rewritten.
CREATE FUNCTION protect_semantic_analysis_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.work_id,NEW.owner_user_id,NEW.version,NEW.locale,NEW.content_hash,NEW.structured_body)
    IS DISTINCT FROM (OLD.work_id,OLD.owner_user_id,OLD.version,OLD.locale,OLD.content_hash,OLD.structured_body)
    AND EXISTS(SELECT 1 FROM story_analysis_jobs WHERE manuscript_version_id=OLD.id AND pipeline='semantic_extraction_v1')
  THEN RAISE EXCEPTION 'Analyzed manuscript versions are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_semantic_analysis_source BEFORE UPDATE ON story_manuscript_versions
  FOR EACH ROW EXECUTE FUNCTION protect_semantic_analysis_source();
COMMIT;
