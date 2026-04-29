CREATE TABLE user_gift_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL REFERENCES users(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  amount_lumina numeric(18, 2) NOT NULL,
  sender_ledger_id uuid,
  recipient_ledger_id uuid,
  message text,
  status text NOT NULL DEFAULT 'completed',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_gift_transfers_positive_amount CHECK (amount_lumina > 0),
  CONSTRAINT user_gift_transfers_no_self_send CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX idx_user_gift_transfers_sender_created
  ON user_gift_transfers(sender_user_id, created_at);

CREATE INDEX idx_user_gift_transfers_recipient_created
  ON user_gift_transfers(recipient_user_id, created_at);
