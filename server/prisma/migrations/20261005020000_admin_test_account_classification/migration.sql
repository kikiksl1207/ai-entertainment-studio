CREATE TABLE admin_test_account_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('test', 'unclassified')),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0 AND expected_revision < 2147483647),
  revision integer NOT NULL CHECK (revision > 0 AND revision = expected_revision + 1),
  reason_code text NOT NULL,
  request_key_hash char(64) NOT NULL CHECK (request_key_hash ~ '^[0-9a-f]{64}$'),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_admin_test_account_reason CHECK (
    (classification = 'test' AND reason_code IN ('qa_owned', 'fixture', 'manual_confirmation')) OR
    (classification = 'unclassified' AND reason_code = 'clear')
  ),
  CONSTRAINT uq_admin_test_account_actor_key UNIQUE (actor_user_id, request_key_hash),
  CONSTRAINT uq_admin_test_account_user_revision UNIQUE (user_id, revision),
  CONSTRAINT uq_admin_test_account_change_binding UNIQUE (id, user_id, revision, classification)
);

CREATE TABLE admin_test_account_states (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('test', 'unclassified')),
  revision integer NOT NULL CHECK (revision > 0),
  latest_change_id uuid NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_admin_test_account_current_change FOREIGN KEY (latest_change_id, user_id, revision, classification)
    REFERENCES admin_test_account_changes(id, user_id, revision, classification) ON DELETE RESTRICT
);
CREATE INDEX idx_admin_test_account_state_classification ON admin_test_account_states(classification, user_id);

CREATE FUNCTION guard_admin_test_account_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'test account classification history is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  SELECT revision INTO current_revision FROM admin_test_account_states WHERE user_id = NEW.user_id;
  IF NEW.expected_revision <> COALESCE(current_revision, 0) THEN
    RAISE EXCEPTION 'test account classification revision changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_admin_test_account_change_guard BEFORE INSERT OR UPDATE OR DELETE
  ON admin_test_account_changes FOR EACH ROW EXECUTE FUNCTION guard_admin_test_account_change();
CREATE TRIGGER trg_admin_test_account_change_no_truncate BEFORE TRUNCATE
  ON admin_test_account_changes FOR EACH STATEMENT EXECUTE FUNCTION guard_admin_test_account_change();

CREATE FUNCTION guard_admin_test_account_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'test account classification must be cleared by a new declaration' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.revision <> 1) OR
     (TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.revision <> OLD.revision + 1)) THEN
    RAISE EXCEPTION 'test account classification state revision changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_admin_test_account_state_guard BEFORE INSERT OR UPDATE OR DELETE
  ON admin_test_account_states FOR EACH ROW EXECUTE FUNCTION guard_admin_test_account_state();
CREATE TRIGGER trg_admin_test_account_state_no_truncate BEFORE TRUNCATE
  ON admin_test_account_states FOR EACH STATEMENT EXECUTE FUNCTION guard_admin_test_account_state();

CREATE FUNCTION require_admin_test_account_current_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_test_account_states WHERE user_id = NEW.user_id AND revision >= NEW.revision) THEN
    RAISE EXCEPTION 'test account declaration and current state must commit together' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_admin_test_account_requires_state AFTER INSERT ON admin_test_account_changes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_admin_test_account_current_state();
