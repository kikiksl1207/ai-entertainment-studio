CREATE TABLE IF NOT EXISTS user_identity_verifications (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unverified',
  provider text,
  verified_name_masked text,
  verified_at timestamptz(6),
  expires_at timestamptz(6),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT user_identity_verifications_status_check CHECK (
    status IN ('unverified', 'verified', 'expired', 'needs_review')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_identity_verifications_status
  ON user_identity_verifications(status);

CREATE TABLE IF NOT EXISTS user_payout_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'missing',
  bank_name text,
  account_holder_masked text,
  account_last4 text,
  holder_matches_identity boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT user_payout_accounts_status_check CHECK (
    status IN ('missing', 'registered', 'needs_review', 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_payout_accounts_status
  ON user_payout_accounts(status);

CREATE TABLE IF NOT EXISTS user_payout_exceptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'none',
  reason text,
  document_attached boolean NOT NULL DEFAULT false,
  approved_by_user_id uuid,
  approved_at timestamptz(6),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT user_payout_exceptions_status_check CHECK (
    status IN ('none', 'pending', 'approved', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_payout_exceptions_status
  ON user_payout_exceptions(status);
