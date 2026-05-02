CREATE TABLE "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "artist_id" uuid REFERENCES "artists"("id"),
  "target_type" text,
  "target_id" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_user_notifications_user_read_created"
  ON "user_notifications"("user_id", "read_at", "created_at");

CREATE INDEX "idx_user_notifications_user_type_created"
  ON "user_notifications"("user_id", "type", "created_at");
