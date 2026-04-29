CREATE TABLE user_referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_referral_codes_status
  ON user_referral_codes(status);

CREATE TABLE referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES users(id),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  referral_code_id uuid NOT NULL REFERENCES user_referral_codes(id),
  referrer_amount numeric(18, 2) NOT NULL,
  referred_amount numeric(18, 2) NOT NULL,
  referrer_ledger_id uuid,
  referred_ledger_id uuid,
  status text NOT NULL DEFAULT 'granted',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_rewards_referrer_created
  ON referral_rewards(referrer_user_id, created_at);

CREATE INDEX idx_referral_rewards_code
  ON referral_rewards(referral_code_id);

CREATE TABLE daily_attendance_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  service_date date NOT NULL,
  reward_lumina numeric(18, 2) NOT NULL,
  wallet_ledger_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_attendance_rewards_user_date_key UNIQUE (user_id, service_date)
);

CREATE INDEX idx_daily_attendance_rewards_date
  ON daily_attendance_rewards(service_date);
