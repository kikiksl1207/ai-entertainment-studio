ALTER TABLE user_refresh_tokens
  ADD COLUMN user_agent text,
  ADD COLUMN ip_address text,
  ADD COLUMN last_used_at timestamptz;
