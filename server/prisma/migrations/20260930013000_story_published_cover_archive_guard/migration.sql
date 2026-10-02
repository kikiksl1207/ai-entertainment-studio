CREATE FUNCTION guard_published_story_cover_archive() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM story_works
    WHERE status = 'published'
      AND active_release_id IS NOT NULL
      AND cover_manifest ->> 'assetId' = NEW.id::text
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Published story cover cannot be archived',
      CONSTRAINT = 'story_published_cover_archive_guard';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_published_cover_archive_guard
BEFORE UPDATE OF metadata ON assets
FOR EACH ROW
WHEN (
  NEW.metadata #>> '{lifecycle,status}' = 'archived'
  AND OLD.metadata #>> '{lifecycle,status}' IS DISTINCT FROM 'archived'
)
EXECUTE FUNCTION guard_published_story_cover_archive();
