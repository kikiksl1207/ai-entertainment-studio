ALTER TABLE "artists" DROP CONSTRAINT IF EXISTS "artists_status_check";

ALTER TABLE "artists"
  ADD CONSTRAINT "artists_status_check"
  CHECK ("status" IN ('draft', 'active', 'planned', 'candidate', 'archived'));
