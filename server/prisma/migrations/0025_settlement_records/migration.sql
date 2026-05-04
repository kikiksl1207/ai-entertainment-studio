CREATE TABLE IF NOT EXISTS settlement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_key text NOT NULL UNIQUE,
  settlement_type text NOT NULL,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'estimated',
  artist_id uuid,
  partner_user_id uuid,
  creator_user_id uuid,
  amount_krw numeric(14, 2),
  reason text,
  note text,
  paid_at timestamptz(6),
  payment_method text,
  payout_reference text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT settlement_records_status_check CHECK (
    status IN ('estimated', 'ready', 'hold', 'paid', 'recheck', 'cancelled')
  ),
  CONSTRAINT settlement_records_type_check CHECK (
    settlement_type IN ('artist', 'partner')
  )
);

CREATE INDEX IF NOT EXISTS idx_settlement_records_type_period
  ON settlement_records(settlement_type, period);

CREATE INDEX IF NOT EXISTS idx_settlement_records_status_period
  ON settlement_records(status, period);

CREATE INDEX IF NOT EXISTS idx_settlement_records_partner_period
  ON settlement_records(partner_user_id, period);

CREATE INDEX IF NOT EXISTS idx_settlement_records_artist_period
  ON settlement_records(artist_id, period);
