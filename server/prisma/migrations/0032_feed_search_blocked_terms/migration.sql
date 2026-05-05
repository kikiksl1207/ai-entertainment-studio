CREATE TABLE IF NOT EXISTS "feed_search_blocked_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "keyword" text NOT NULL,
  "normalized_keyword" text NOT NULL,
  "search_type" text NOT NULL DEFAULT 'all',
  "language" text NOT NULL DEFAULT 'all',
  "status" text NOT NULL DEFAULT 'active',
  "reason" text,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "updated_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "feed_search_blocked_terms_type_check"
    CHECK ("search_type" IN ('all', 'text', 'hashtag')),
  CONSTRAINT "feed_search_blocked_terms_language_check"
    CHECK ("language" IN ('all', 'ko', 'ja', 'en', 'zh', 'unknown')),
  CONSTRAINT "feed_search_blocked_terms_status_check"
    CHECK ("status" IN ('active', 'inactive', 'archived')),
  CONSTRAINT "uq_feed_search_blocked_terms_scope"
    UNIQUE ("normalized_keyword", "search_type", "language")
);

CREATE INDEX IF NOT EXISTS "idx_feed_search_blocked_terms_status_scope"
  ON "feed_search_blocked_terms" ("status", "language", "search_type");

CREATE INDEX IF NOT EXISTS "idx_feed_search_blocked_terms_keyword"
  ON "feed_search_blocked_terms" ("normalized_keyword");
