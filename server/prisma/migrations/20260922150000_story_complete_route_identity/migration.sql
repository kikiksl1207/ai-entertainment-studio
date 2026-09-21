BEGIN;
CREATE TABLE story_progress_route_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), progress_id UUID NOT NULL,
  work_id UUID NOT NULL, release_id UUID NOT NULL, parent_id UUID,
  route_hash TEXT CHECK (route_hash IS NULL OR route_hash ~ '^[a-f0-9]{64}$'),
  depth INTEGER NOT NULL CHECK (depth >= 0),
  step_kind TEXT NOT NULL CHECK (step_kind IN ('root','canonical','shared','private')),
  source_scene_id UUID, source_choice_id UUID, source_shared_result_id UUID,
  source_shared_choice_key TEXT, target_scene_id UUID, ending_key TEXT,
  act_number INTEGER NOT NULL CHECK (act_number > 0),
  narrative_step JSONB CHECK (narrative_step IS NULL OR jsonb_typeof(narrative_step)='object'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_story_route_node_progress UNIQUE (progress_id,id),
  CONSTRAINT uq_story_route_node_owner UNIQUE (id,progress_id,work_id,release_id),
  FOREIGN KEY (work_id,progress_id) REFERENCES story_reader_progress(work_id,id),
  FOREIGN KEY (work_id,release_id) REFERENCES story_releases(work_id,id),
  FOREIGN KEY (parent_id,progress_id,work_id,release_id) REFERENCES story_progress_route_nodes(id,progress_id,work_id,release_id),
  FOREIGN KEY (source_scene_id,source_choice_id) REFERENCES story_choices(scene_id,id),
  FOREIGN KEY (source_shared_result_id,work_id,release_id) REFERENCES story_ai_reusable_results(id,work_id,release_id),
  FOREIGN KEY (source_shared_result_id,source_shared_choice_key) REFERENCES story_ai_reusable_choices(shared_result_id,choice_key),
  CHECK ((step_kind='root' AND parent_id IS NULL AND depth=0 AND route_hash IS NOT NULL
      AND target_scene_id IS NOT NULL AND source_scene_id IS NULL AND source_choice_id IS NULL
      AND source_shared_result_id IS NULL AND source_shared_choice_key IS NULL)
    OR (step_kind='canonical' AND parent_id IS NOT NULL AND source_scene_id IS NOT NULL AND source_choice_id IS NOT NULL
      AND source_shared_result_id IS NULL AND source_shared_choice_key IS NULL)
    OR (step_kind='shared' AND parent_id IS NOT NULL AND source_shared_result_id IS NOT NULL AND source_shared_choice_key IS NOT NULL
      AND source_scene_id IS NULL AND source_choice_id IS NULL)
    OR (step_kind='private' AND parent_id IS NOT NULL AND route_hash IS NULL
      AND source_scene_id IS NULL AND source_choice_id IS NULL AND source_shared_result_id IS NULL AND source_shared_choice_key IS NULL))
);
CREATE INDEX idx_story_route_node_progress ON story_progress_route_nodes(progress_id,created_at);
ALTER TABLE story_reader_progress ADD COLUMN route_node_id UUID,
  ADD CONSTRAINT story_progress_route_owner_fk FOREIGN KEY (route_node_id,id,work_id,active_release_id)
    REFERENCES story_progress_route_nodes(id,progress_id,work_id,release_id);
ALTER TABLE story_progress_checkpoints ADD COLUMN route_node_id UUID,
  ADD CONSTRAINT story_checkpoint_route_owner_fk FOREIGN KEY (progress_id,route_node_id)
    REFERENCES story_progress_route_nodes(progress_id,id);
ALTER TABLE story_ai_continuations ADD COLUMN source_route_node_id UUID, ADD COLUMN source_route_hash TEXT,
  ADD CONSTRAINT story_continuation_route_owner_fk FOREIGN KEY (source_route_node_id,progress_id,work_id,release_id)
    REFERENCES story_progress_route_nodes(id,progress_id,work_id,release_id),
  ADD CONSTRAINT story_continuation_route_hash_check CHECK (source_route_hash IS NULL OR source_route_hash ~ '^[a-f0-9]{64}$');

-- No backfill: a bounded legacy path is not evidence of a complete route.
CREATE FUNCTION guard_story_progress_route_node() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent story_progress_route_nodes;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'story route nodes are append-only'; END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM story_progress_route_nodes WHERE id=NEW.parent_id;
    IF parent.id IS NULL OR NEW.depth<>parent.depth+1 OR (parent.route_hash IS NULL AND NEW.route_hash IS NOT NULL) THEN
      RAISE EXCEPTION 'story route ancestry is incomplete';
    END IF;
  END IF;
  IF NEW.step_kind='shared' AND NOT EXISTS (SELECT 1 FROM story_ai_reusable_results
    WHERE id=NEW.source_shared_result_id AND status='approved') THEN
    RAISE EXCEPTION 'story route requires approved shared source';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.source_scene_id,NEW.target_scene_id]) scene_id
    WHERE scene_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_scenes s JOIN story_parts p ON p.id=s.part_id
      WHERE s.id=scene_id AND p.work_id=NEW.work_id)) THEN
    RAISE EXCEPTION 'story route canonical source owner mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_route_node_guard BEFORE INSERT OR UPDATE OR DELETE ON story_progress_route_nodes
  FOR EACH ROW EXECUTE FUNCTION guard_story_progress_route_node();

CREATE FUNCTION guard_story_continuation_route_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.source_route_node_id IS DISTINCT FROM OLD.source_route_node_id
    OR NEW.source_route_hash IS DISTINCT FROM OLD.source_route_hash) THEN
    RAISE EXCEPTION 'continuation route pin is immutable';
  END IF;
  IF NEW.source_route_node_id IS NULL THEN
    IF NEW.source_route_hash IS NOT NULL THEN RAISE EXCEPTION 'route hash requires a complete source node'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM story_progress_route_nodes WHERE id=NEW.source_route_node_id
    AND route_hash IS NOT DISTINCT FROM NEW.source_route_hash) THEN
    RAISE EXCEPTION 'continuation route hash does not match source node';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_continuation_route_pin_guard BEFORE INSERT OR UPDATE ON story_ai_continuations
  FOR EACH ROW EXECUTE FUNCTION guard_story_continuation_route_pin();
COMMIT;
