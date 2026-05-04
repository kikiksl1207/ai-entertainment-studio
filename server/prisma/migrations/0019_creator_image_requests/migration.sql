CREATE TABLE "creator_image_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requester_user_id" UUID NOT NULL,
  "artist_id" UUID NOT NULL,
  "request_type" TEXT NOT NULL,
  "title" TEXT,
  "brief" TEXT NOT NULL,
  "prompt" TEXT,
  "reference_asset_ids" JSONB NOT NULL DEFAULT '[]',
  "result_asset_ids" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "moderation_status" TEXT NOT NULL DEFAULT 'pending',
  "admin_note" TEXT,
  "rejection_reason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "creator_image_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "creator_image_requests"
ADD CONSTRAINT "creator_image_requests_requester_user_id_fkey"
FOREIGN KEY ("requester_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creator_image_requests"
ADD CONSTRAINT "creator_image_requests_artist_id_fkey"
FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_creator_image_requests_requester_created"
ON "creator_image_requests"("requester_user_id", "created_at");

CREATE INDEX "idx_creator_image_requests_artist_status"
ON "creator_image_requests"("artist_id", "status", "created_at");

CREATE INDEX "idx_creator_image_requests_status_created"
ON "creator_image_requests"("status", "created_at");
