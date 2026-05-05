CREATE TABLE IF NOT EXISTS "settlement_lumina_conversion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requester_user_id" uuid NOT NULL,
  "settlement_key" text NOT NULL,
  "settlement_type" text NOT NULL,
  "period" text NOT NULL,
  "target_artist_id" uuid,
  "amount_krw" numeric(14,2) NOT NULL,
  "requested_lumina" numeric(18,2) NOT NULL,
  "status" text NOT NULL DEFAULT 'requested',
  "note" text,
  "admin_note" text,
  "wallet_ledger_id" uuid,
  "processed_by_user_id" uuid,
  "processed_at" timestamptz(6),
  "idempotency_key" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "settlement_lumina_conversion_status_check"
    CHECK ("status" IN ('requested', 'approved', 'rejected', 'credited', 'cancelled')),
  CONSTRAINT "settlement_lumina_conversion_type_check"
    CHECK ("settlement_type" IN ('artist', 'partner'))
);

CREATE INDEX IF NOT EXISTS "idx_settlement_lumina_conversions_requester"
  ON "settlement_lumina_conversion_requests" ("requester_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_settlement_lumina_conversions_key_status"
  ON "settlement_lumina_conversion_requests" ("settlement_key", "status");

CREATE INDEX IF NOT EXISTS "idx_settlement_lumina_conversions_status"
  ON "settlement_lumina_conversion_requests" ("status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_settlement_lumina_conversions_idempotency"
  ON "settlement_lumina_conversion_requests" ("requester_user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
