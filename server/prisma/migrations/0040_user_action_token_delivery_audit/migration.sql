ALTER TABLE "user_action_tokens"
  ADD COLUMN "delivery_status" TEXT NOT NULL DEFAULT 'not_recorded',
  ADD COLUMN "delivery_channel" TEXT,
  ADD COLUMN "delivery_provider" TEXT,
  ADD COLUMN "delivery_attempted_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_failed_at" TIMESTAMPTZ(6),
  ADD COLUMN "target_email_masked" TEXT;

CREATE INDEX "idx_user_action_tokens_delivery_status"
  ON "user_action_tokens" ("delivery_status", "delivery_attempted_at");
