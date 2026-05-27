CREATE TABLE "premium_chat_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "tier_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "amount_lumina" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remaining_units" INTEGER,
    "opened_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "last_user_message_at" TIMESTAMPTZ(6),
    "last_artist_reply_at" TIMESTAMPTZ(6),
    "last_support_at" TIMESTAMPTZ(6),
    "reported_at" TIMESTAMPTZ(6),
    "admin_review_at" TIMESTAMPTZ(6),
    "refund_candidate_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_premium_chat_rooms_owner_status_updated" ON "premium_chat_rooms"("owner_user_id", "status", "updated_at");
CREATE INDEX "idx_premium_chat_rooms_artist_status_updated" ON "premium_chat_rooms"("artist_id", "status", "updated_at");
CREATE INDEX "idx_premium_chat_rooms_status_expires" ON "premium_chat_rooms"("status", "expires_at");

ALTER TABLE "premium_chat_rooms"
ADD CONSTRAINT "premium_chat_rooms_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "premium_chat_rooms"
ADD CONSTRAINT "premium_chat_rooms_artist_id_fkey"
FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
