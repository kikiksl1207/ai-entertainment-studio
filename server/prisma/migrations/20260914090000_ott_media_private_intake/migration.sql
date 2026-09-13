CREATE TABLE "ott_media_works" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ott_media_works_owner_id_idx" ON "ott_media_works"("owner_id");
CREATE TABLE "ott_media_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL REFERENCES "ott_media_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ott_media_versions_work_id_version_key" ON "ott_media_versions"("work_id", "version");
CREATE TABLE "ott_media_uploads" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version_id" UUID NOT NULL REFERENCES "ott_media_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "intent_key" TEXT NOT NULL,
  "expected" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_upload' CHECK ("status" IN ('pending_upload', 'uploaded', 'confirmed')),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "verified" JSONB,
  "subtitles" JSONB,
  "confirmation_hash" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("status" <> 'confirmed' OR ("verified" IS NOT NULL AND "subtitles" IS NOT NULL AND "confirmation_hash" IS NOT NULL))
);
CREATE UNIQUE INDEX "ott_media_uploads_version_id_key" ON "ott_media_uploads"("version_id");
CREATE UNIQUE INDEX "ott_media_uploads_owner_id_intent_key_key" ON "ott_media_uploads"("owner_id", "intent_key");

CREATE FUNCTION ott_media_guard_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.owner_id, NEW.version_id, NEW.intent_key, NEW.expected, NEW.expires_at, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.owner_id, OLD.version_id, OLD.intent_key, OLD.expected, OLD.expires_at, OLD.created_at) THEN
      RAISE EXCEPTION 'OTT immutable registration';
    END IF;
    IF OLD.status = 'confirmed' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'OTT immutable confirmation';
    END IF;
    IF (OLD.status = 'uploaded' AND NEW.status = 'pending_upload') OR (OLD.status = 'pending_upload' AND NEW.status = 'confirmed') THEN
      RAISE EXCEPTION 'OTT invalid state transition';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ott_media_versions v JOIN ott_media_works w ON w.id=v.work_id
    WHERE v.id=NEW.version_id AND w.owner_id=NEW.owner_id) THEN
    RAISE EXCEPTION 'OTT owner version mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ott_media_upload_guard BEFORE INSERT OR UPDATE ON ott_media_uploads
  FOR EACH ROW EXECUTE FUNCTION ott_media_guard_upload();
