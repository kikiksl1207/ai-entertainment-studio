CREATE TABLE "fan_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sender_user_id" uuid NOT NULL,
  "artist_id" uuid NOT NULL,
  "wallet_ledger_id" uuid,
  "status" text NOT NULL DEFAULT 'submitted',
  "moderation_status" text NOT NULL DEFAULT 'pending',
  "amount_lumina" numeric(18,2) NOT NULL DEFAULT 30,
  "title" text,
  "body" text NOT NULL,
  "reply_body" text,
  "replied_at" timestamptz(6),
  "replied_by_user_id" uuid,
  "idempotency_key" text UNIQUE,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fan_letters_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id"),
  CONSTRAINT "fan_letters_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id"),
  CONSTRAINT "fan_letters_wallet_ledger_id_fkey" FOREIGN KEY ("wallet_ledger_id") REFERENCES "wallet_ledger"("id"),
  CONSTRAINT "fan_letters_replied_by_user_id_fkey" FOREIGN KEY ("replied_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "fan_letters_status_check" CHECK ("status" IN ('submitted', 'seen', 'replied', 'archived', 'refunded')),
  CONSTRAINT "fan_letters_moderation_status_check" CHECK ("moderation_status" IN ('pending', 'cleared', 'blocked', 'needs_review')),
  CONSTRAINT "fan_letters_amount_lumina_check" CHECK ("amount_lumina" >= 0)
);

CREATE INDEX "idx_fan_letters_sender_created" ON "fan_letters" ("sender_user_id", "created_at");
CREATE INDEX "idx_fan_letters_artist_status_created" ON "fan_letters" ("artist_id", "status", "created_at");
CREATE INDEX "idx_fan_letters_moderation_created" ON "fan_letters" ("moderation_status", "created_at");
