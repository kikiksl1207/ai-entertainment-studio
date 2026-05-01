ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz;

CREATE TABLE user_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_action_tokens_user_purpose
  ON user_action_tokens(user_id, purpose, consumed_at, expires_at);
