BEGIN;
CREATE UNIQUE INDEX uq_ott_media_work_owner ON ott_media_works(id,owner_id);
CREATE UNIQUE INDEX uq_ott_media_version_work ON ott_media_versions(id,work_id);
CREATE UNIQUE INDEX uq_ott_media_file_owner_version ON ott_media_uploads(id,owner_id,version_id);
CREATE UNIQUE INDEX uq_ott_media_file_owner ON ott_media_uploads(id,owner_id);
CREATE TABLE ott_media_revocations (
  file_id UUID PRIMARY KEY, owner_id UUID NOT NULL, created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id,owner_id) REFERENCES ott_media_uploads(id,owner_id)
);
CREATE TABLE ott_playback_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL, work_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), graph JSONB NOT NULL CHECK(jsonb_typeof(graph)='object'),
  checksum TEXT NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'), request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(work_id,revision), UNIQUE(owner_id,request_key), CONSTRAINT uq_ott_playback_manifest_owner UNIQUE(id,owner_id,work_id),
  FOREIGN KEY(work_id,owner_id) REFERENCES ott_media_works(id,owner_id)
);
CREATE TABLE ott_playback_asset_pins (
  manifest_id UUID NOT NULL, owner_id UUID NOT NULL, work_id UUID NOT NULL, file_id UUID NOT NULL,
  media_version_id UUID NOT NULL, checksum TEXT NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  duration_ms INTEGER NOT NULL CHECK(duration_ms>0 AND duration_ms<=1200000),
  confirmation_hash TEXT NOT NULL CHECK(confirmation_hash~'^[a-f0-9]{64}$'),
  PRIMARY KEY(manifest_id,file_id),
  FOREIGN KEY(manifest_id,owner_id,work_id) REFERENCES ott_playback_manifests(id,owner_id,work_id),
  FOREIGN KEY(file_id,owner_id,media_version_id) REFERENCES ott_media_uploads(id,owner_id,version_id),
  FOREIGN KEY(media_version_id,work_id) REFERENCES ott_media_versions(id,work_id)
);
CREATE TABLE ott_playback_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), manifest_id UUID NOT NULL, owner_id UUID NOT NULL, work_id UUID NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('ko','en','ja','zh-Hans','zh-Hant')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(manifest_id,locale), CONSTRAINT uq_ott_playback_preview_owner UNIQUE(id,manifest_id,owner_id,work_id),
  FOREIGN KEY(manifest_id,owner_id,work_id) REFERENCES ott_playback_manifests(id,owner_id,work_id)
);
CREATE TABLE ott_playback_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL, work_id UUID NOT NULL,
  manifest_id UUID NOT NULL, preview_id UUID NOT NULL, current_node_key TEXT NOT NULL,
  position_ms INTEGER NOT NULL CHECK(position_ms>=0), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id,preview_id), CONSTRAINT uq_ott_playback_progress_owner UNIQUE(id,owner_id),
  FOREIGN KEY(preview_id,manifest_id,owner_id,work_id) REFERENCES ott_playback_previews(id,manifest_id,owner_id,work_id)
);
CREATE TABLE ott_playback_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL, progress_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('choice','position')),
  request_hash TEXT NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), request JSONB NOT NULL CHECK(jsonb_typeof(request)='object'),
  from_revision INTEGER NOT NULL CHECK(from_revision>0),
  to_revision INTEGER NOT NULL CHECK(to_revision=from_revision+1), snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id,idempotency_key), UNIQUE(progress_id,to_revision),
  FOREIGN KEY(progress_id,owner_id) REFERENCES ott_playback_progress(id,owner_id)
);
CREATE FUNCTION ott_playback_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'OTT playback immutable history'; END $$;
CREATE TRIGGER ott_media_revocation_immutable BEFORE UPDATE OR DELETE ON ott_media_revocations FOR EACH ROW EXECUTE FUNCTION ott_playback_immutable();
CREATE TRIGGER ott_playback_manifest_immutable BEFORE UPDATE OR DELETE ON ott_playback_manifests FOR EACH ROW EXECUTE FUNCTION ott_playback_immutable();
CREATE TRIGGER ott_playback_asset_immutable BEFORE UPDATE OR DELETE ON ott_playback_asset_pins FOR EACH ROW EXECUTE FUNCTION ott_playback_immutable();
CREATE TRIGGER ott_playback_preview_immutable BEFORE UPDATE OR DELETE ON ott_playback_previews FOR EACH ROW EXECUTE FUNCTION ott_playback_immutable();
CREATE TRIGGER ott_playback_command_immutable BEFORE UPDATE OR DELETE ON ott_playback_commands FOR EACH ROW EXECUTE FUNCTION ott_playback_immutable();

CREATE FUNCTION ott_media_lock_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM ott_media_uploads WHERE id=NEW.file_id AND owner_id=NEW.owner_id FOR UPDATE;
  RETURN NEW;
END $$;
CREATE TRIGGER ott_media_revocation_lock BEFORE INSERT ON ott_media_revocations FOR EACH ROW EXECUTE FUNCTION ott_media_lock_revocation();

CREATE FUNCTION ott_playback_asset_valid(pin ott_playback_asset_pins) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM ott_media_uploads u JOIN ott_media_versions v ON v.id=u.version_id
    JOIN ott_media_works w ON w.id=v.work_id WHERE u.id=pin.file_id AND u.owner_id=pin.owner_id
      AND v.id=pin.media_version_id AND v.work_id=pin.work_id AND w.owner_id=pin.owner_id AND u.status='confirmed'
      AND u.verified->>'sha256'=pin.checksum AND (u.verified->>'durationMs')::integer=pin.duration_ms
      AND u.confirmation_hash=pin.confirmation_hash AND NOT EXISTS (SELECT 1 FROM ott_media_revocations r WHERE r.file_id=u.id));
$$;
CREATE FUNCTION ott_playback_guard_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize pin sealing and source revocation even for direct SQL writes.
  PERFORM id FROM ott_playback_manifests WHERE id=NEW.manifest_id FOR UPDATE;
  PERFORM id FROM ott_media_uploads WHERE id=NEW.file_id FOR SHARE;
  IF NOT ott_playback_asset_valid(NEW) OR EXISTS(SELECT 1 FROM ott_playback_previews WHERE manifest_id=NEW.manifest_id) THEN
    RAISE EXCEPTION 'OTT playback invalid or sealed asset pin';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ott_playback_asset_guard BEFORE INSERT ON ott_playback_asset_pins FOR EACH ROW EXECUTE FUNCTION ott_playback_guard_asset();

CREATE FUNCTION ott_playback_guard_preview() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest ott_playback_manifests; node JSONB; choice JSONB; pin ott_playback_asset_pins;
BEGIN
  SELECT * INTO manifest FROM ott_playback_manifests WHERE id=NEW.manifest_id FOR UPDATE;
  IF manifest.id IS NULL OR jsonb_typeof(manifest.graph->'nodes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(manifest.graph->'nodes') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'OTT playback invalid graph'; END IF;
  PERFORM u.id FROM ott_media_uploads u JOIN ott_playback_asset_pins p ON p.file_id=u.id
    WHERE p.manifest_id=NEW.manifest_id ORDER BY u.id FOR SHARE OF u;
  FOR node IN SELECT value FROM jsonb_array_elements(manifest.graph->'nodes') LOOP
    SELECT * INTO pin FROM ott_playback_asset_pins WHERE manifest_id=NEW.manifest_id AND file_id=(node->'clip'->>'fileId')::uuid;
    IF pin.file_id IS NULL OR pin.media_version_id IS DISTINCT FROM (node->'clip'->>'mediaVersionId')::uuid
      OR jsonb_typeof(node->'clip'->'startMs') IS DISTINCT FROM 'number'
      OR jsonb_typeof(node->'clip'->'endMs') IS DISTINCT FROM 'number'
      OR NOT ott_playback_asset_valid(pin) OR (node->'clip'->>'startMs')::integer<0
      OR (node->'clip'->>'endMs')::integer>(pin.duration_ms)
      OR (node->'clip'->>'endMs')::integer<=(node->'clip'->>'startMs')::integer THEN
      RAISE EXCEPTION 'OTT playback missing or invalid clip';
    END IF;
    IF jsonb_typeof(node->'choices') IS DISTINCT FROM 'array' OR jsonb_array_length(node->'choices')>3 THEN
      RAISE EXCEPTION 'OTT playback invalid choices';
    END IF;
    FOR choice IN SELECT value FROM jsonb_array_elements(node->'choices') LOOP
      IF COALESCE(length(choice->'label'->>NEW.locale),0)=0 THEN RAISE EXCEPTION 'OTT playback missing locale'; END IF;
    END LOOP;
    IF jsonb_array_length(node->'choices')=0 AND COALESCE(length(node->'ending'->'label'->>NEW.locale),0)=0 THEN
      RAISE EXCEPTION 'OTT playback missing ending locale';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER ott_playback_preview_guard BEFORE INSERT ON ott_playback_previews FOR EACH ROW EXECUTE FUNCTION ott_playback_guard_preview();

CREATE FUNCTION ott_playback_guard_progress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE node JSONB; old_node JSONB; graph JSONB; pin ott_playback_asset_pins;
BEGIN
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.owner_id,NEW.work_id,NEW.manifest_id,NEW.preview_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.work_id,OLD.manifest_id,OLD.preview_id,OLD.created_at)
    OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'OTT playback immutable scope or stale revision'; END IF;
  SELECT m.graph INTO graph FROM ott_playback_manifests m WHERE m.id=NEW.manifest_id;
  SELECT n INTO node FROM jsonb_array_elements(graph->'nodes') n WHERE n->>'key'=NEW.current_node_key;
  IF node IS NULL OR jsonb_typeof(node->'clip') IS DISTINCT FROM 'object'
    OR NEW.position_ms<(node->'clip'->>'startMs')::integer
    OR NEW.position_ms>(node->'clip'->>'endMs')::integer THEN RAISE EXCEPTION 'OTT playback invalid position'; END IF;
  IF NEW.status IS DISTINCT FROM (CASE WHEN jsonb_typeof(node->'ending')='object'
    AND NEW.position_ms=(node->'clip'->>'endMs')::integer THEN 'completed' ELSE 'active' END) THEN
    RAISE EXCEPTION 'OTT playback invalid completion';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.current_node_key IS DISTINCT FROM graph->>'entryNodeKey'
      OR NEW.position_ms IS DISTINCT FROM (node->'clip'->>'startMs')::integer THEN
      RAISE EXCEPTION 'OTT playback invalid start';
    END IF;
  ELSIF NEW.current_node_key IS DISTINCT FROM OLD.current_node_key THEN
    SELECT n INTO old_node FROM jsonb_array_elements(graph->'nodes') n WHERE n->>'key'=OLD.current_node_key;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_node->'choices') c WHERE c->>'targetNodeKey'=NEW.current_node_key)
      OR NEW.position_ms IS DISTINCT FROM (node->'clip'->>'startMs')::integer THEN
      RAISE EXCEPTION 'OTT playback invalid transition';
    END IF;
  END IF;
  PERFORM u.id FROM ott_media_uploads u JOIN ott_playback_asset_pins p ON p.file_id=u.id
    WHERE p.manifest_id=NEW.manifest_id ORDER BY u.id FOR SHARE OF u;
  FOR pin IN SELECT * FROM ott_playback_asset_pins WHERE manifest_id=NEW.manifest_id LOOP
    IF NOT ott_playback_asset_valid(pin) THEN RAISE EXCEPTION 'OTT playback invalidated media'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER ott_playback_progress_guard BEFORE INSERT OR UPDATE ON ott_playback_progress FOR EACH ROW EXECUTE FUNCTION ott_playback_guard_progress();
COMMIT;
