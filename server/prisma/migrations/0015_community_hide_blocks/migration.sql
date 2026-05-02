CREATE TABLE "community_hidden_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "post_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "community_hidden_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_blocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "blocker_user_id" UUID NOT NULL,
  "blocked_user_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_hidden_posts_user_id_post_id_key"
  ON "community_hidden_posts"("user_id", "post_id");
CREATE INDEX "idx_community_hidden_posts_user_status"
  ON "community_hidden_posts"("user_id", "status", "created_at");
CREATE INDEX "idx_community_hidden_posts_post_status"
  ON "community_hidden_posts"("post_id", "status");

CREATE UNIQUE INDEX "user_blocks_blocker_user_id_blocked_user_id_key"
  ON "user_blocks"("blocker_user_id", "blocked_user_id");
CREATE INDEX "idx_user_blocks_blocker_status"
  ON "user_blocks"("blocker_user_id", "status");
CREATE INDEX "idx_user_blocks_blocked_status"
  ON "user_blocks"("blocked_user_id", "status");

ALTER TABLE "community_hidden_posts"
  ADD CONSTRAINT "community_hidden_posts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "community_hidden_posts"
  ADD CONSTRAINT "community_hidden_posts_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_blocker_user_id_fkey"
  FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_blocked_user_id_fkey"
  FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
