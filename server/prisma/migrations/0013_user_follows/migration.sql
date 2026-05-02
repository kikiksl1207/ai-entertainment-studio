CREATE TABLE "user_follows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "follower_user_id" UUID NOT NULL,
  "following_user_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_follows_follower_user_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_follows_following_user_id_fkey" FOREIGN KEY ("following_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_follows_follower_user_id_following_user_id_key"
ON "user_follows"("follower_user_id", "following_user_id");

CREATE INDEX "idx_user_follows_following_status"
ON "user_follows"("following_user_id", "status");

CREATE INDEX "idx_user_follows_follower_status"
ON "user_follows"("follower_user_id", "status");
