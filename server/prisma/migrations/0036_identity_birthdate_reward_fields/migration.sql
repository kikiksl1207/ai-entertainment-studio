ALTER TABLE user_identity_verifications
  ADD COLUMN identity_subject_hash text,
  ADD COLUMN birth_date date;

CREATE INDEX idx_user_identity_verifications_subject_hash
  ON user_identity_verifications(identity_subject_hash);
