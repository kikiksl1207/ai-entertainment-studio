CREATE TABLE "artist_knowledge_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "artist_id" UUID NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_domain" TEXT NOT NULL,
  "source_platform" TEXT NOT NULL DEFAULT 'other',
  "source_type" TEXT NOT NULL DEFAULT 'other',
  "title" TEXT,
  "artist_description" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'chat_reference',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reject_reason" TEXT,
  "created_by_user_id" UUID,
  "updated_by_user_id" UUID,
  "reviewed_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artist_knowledge_sources_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "artist_knowledge_sources"
ADD CONSTRAINT "artist_knowledge_sources_artist_id_fkey"
FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_artist_knowledge_sources_artist_url"
ON "artist_knowledge_sources"("artist_id", "source_url");

CREATE INDEX "idx_artist_knowledge_sources_chat_lookup"
ON "artist_knowledge_sources"("artist_id", "status", "visibility", "approved_at");

CREATE INDEX "idx_artist_knowledge_sources_artist_status"
ON "artist_knowledge_sources"("artist_id", "status", "updated_at");
