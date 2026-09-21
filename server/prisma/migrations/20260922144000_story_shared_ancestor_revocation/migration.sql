BEGIN;

-- Preserve the existing snapshot/lifecycle guards, changing only the source
-- approval requirement for terminal withdrawal. Assert the expected definition
-- so an unexpected older database cannot silently receive a partial patch.
DO $$
DECLARE definition TEXT; original TEXT := 'IF NEW."source_kind" = ''generated'' AND NOT EXISTS (';
BEGIN
  SELECT pg_get_functiondef('guard_story_ai_reusable_result()'::regprocedure) INTO definition;
  IF strpos(definition, original)=0 THEN RAISE EXCEPTION 'unexpected shared result guard definition'; END IF;
  EXECUTE replace(definition, original,
    'IF NEW."source_kind" = ''generated'' AND NEW."status" <> ''revoked'' AND NOT EXISTS (');
END $$;

-- The exact lineage is at most 2048 reads by primary key. Overlong, incomplete or
-- cyclic ancestry fails closed rather than consuming unbounded work.
CREATE FUNCTION story_ai_shared_ancestry_valid(result_id UUID) RETURNS BOOLEAN LANGUAGE sql VOLATILE AS $$
  WITH RECURSIVE ancestry AS (
    SELECT id,source_shared_result_id,source_kind,status,1 AS depth
      FROM story_ai_reusable_results WHERE id=result_id
    UNION ALL
    SELECT r.id,r.source_shared_result_id,r.source_kind,r.status,a.depth+1
      FROM story_ai_reusable_results r JOIN ancestry a ON r.id=a.source_shared_result_id WHERE a.depth<2048
  ) SELECT COALESCE(bool_and(status='approved') AND bool_or(source_kind='canonical'),false) FROM ancestry;
$$;

CREATE FUNCTION guard_story_ai_shared_ancestry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='approved' AND NEW.source_kind='generated'
    AND NOT story_ai_shared_ancestry_valid(NEW.source_shared_result_id) THEN
    RAISE EXCEPTION 'shared story result ancestor is not approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER story_ai_shared_ancestry_guard BEFORE INSERT OR UPDATE ON story_ai_reusable_results
  FOR EACH ROW EXECUTE FUNCTION guard_story_ai_shared_ancestry();
COMMIT;
