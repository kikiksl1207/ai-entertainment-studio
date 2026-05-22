CREATE TABLE "artist_knowledge_urls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "artist_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_type" TEXT NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "canonical_url" VARCHAR(2000) NOT NULL,
    "artist_description" VARCHAR(500) NOT NULL,
    "summary" VARCHAR(700) NOT NULL,
    "allow_chat_reference" BOOLEAN NOT NULL DEFAULT true,
    "rejection_reason" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "artist_knowledge_urls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artist_knowledge_urls_artist_id_canonical_url_key"
    ON "artist_knowledge_urls"("artist_id", "canonical_url");

CREATE INDEX "idx_artist_knowledge_urls_artist_status"
    ON "artist_knowledge_urls"("artist_id", "status", "created_at");

CREATE INDEX "idx_artist_knowledge_urls_submitter"
    ON "artist_knowledge_urls"("submitted_by_user_id", "created_at");

CREATE INDEX "idx_artist_knowledge_urls_reviewer"
    ON "artist_knowledge_urls"("reviewed_by_user_id", "reviewed_at");

ALTER TABLE "artist_knowledge_urls"
    ADD CONSTRAINT "artist_knowledge_urls_artist_id_fkey"
    FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "artist_knowledge_urls"
    ADD CONSTRAINT "artist_knowledge_urls_submitted_by_user_id_fkey"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "artist_knowledge_urls"
    ADD CONSTRAINT "artist_knowledge_urls_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "artist_knowledge_sources";
