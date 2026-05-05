CREATE TABLE IF NOT EXISTS "feed_search_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id"),
  "visitor_hash" text,
  "keyword" text NOT NULL,
  "normalized_keyword" text NOT NULL,
  "search_type" text NOT NULL DEFAULT 'text',
  "language" text NOT NULL DEFAULT 'unknown',
  "source" text NOT NULL DEFAULT 'lumina_feed',
  "result_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "feed_search_events_type_check"
    CHECK ("search_type" IN ('text', 'hashtag')),
  CONSTRAINT "feed_search_events_language_check"
    CHECK ("language" IN ('ko', 'ja', 'en', 'zh', 'unknown'))
);

CREATE INDEX IF NOT EXISTS "idx_feed_search_events_lang_type_created"
  ON "feed_search_events" ("language", "search_type", "created_at");

CREATE INDEX IF NOT EXISTS "idx_feed_search_events_keyword_created"
  ON "feed_search_events" ("normalized_keyword", "created_at");

CREATE INDEX IF NOT EXISTS "idx_feed_search_events_user_created"
  ON "feed_search_events" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_feed_search_events_visitor_created"
  ON "feed_search_events" ("visitor_hash", "created_at");
