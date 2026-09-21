BEGIN;
-- Evidence binds the private snapshot, not just its checksum column. Preserve it
-- after review starts while still allowing personal invalidation and provenance links.
CREATE FUNCTION guard_story_ai_reviewed_scene() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM story_ai_reusable_results WHERE origin_generated_scene_id=OLD.id) THEN
    IF TG_OP='DELETE' OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.visual_manifest IS DISTINCT FROM OLD.visual_manifest
      OR NEW.ending_type IS DISTINCT FROM OLD.ending_type
      OR NEW.result_checksum IS DISTINCT FROM OLD.result_checksum
      OR NEW.continuation_id IS DISTINCT FROM OLD.continuation_id
      OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.release_id IS DISTINCT FROM OLD.release_id
      OR NEW.provenance IS DISTINCT FROM OLD.provenance THEN
      RAISE EXCEPTION 'story AI reviewed origin is immutable';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_reviewed_scene_guard BEFORE UPDATE OR DELETE ON story_ai_generated_scenes
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_reviewed_scene();

CREATE FUNCTION guard_story_ai_reviewed_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id UUID;
BEGIN
  source_id := CASE WHEN TG_OP='DELETE' THEN OLD.scene_id ELSE NEW.scene_id END;
  PERFORM 1 FROM story_ai_generated_scenes WHERE id=source_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM story_ai_reusable_results WHERE origin_generated_scene_id=source_id)
    OR (TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM story_ai_reusable_results WHERE origin_generated_scene_id=OLD.scene_id)) THEN
    RAISE EXCEPTION 'story AI reviewed origin children are immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_reviewed_beats_guard BEFORE INSERT OR UPDATE OR DELETE ON story_ai_generated_beats
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_reviewed_child();
CREATE TRIGGER story_ai_reviewed_choices_guard BEFORE INSERT OR UPDATE OR DELETE ON story_ai_generated_choices
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_reviewed_child();

CREATE FUNCTION lock_story_ai_review_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin_generated_scene_id IS NOT NULL THEN
    PERFORM 1 FROM story_ai_generated_scenes WHERE id=NEW.origin_generated_scene_id FOR SHARE;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_00_lock_review_origin BEFORE UPDATE ON story_ai_reusable_results
  FOR EACH ROW EXECUTE FUNCTION lock_story_ai_review_origin();
COMMIT;
