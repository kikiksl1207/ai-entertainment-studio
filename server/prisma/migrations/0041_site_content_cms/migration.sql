CREATE TABLE "site_content_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_key" text NOT NULL,
  "scope" text NOT NULL,
  "page_key" text,
  "character_slug" text,
  "model_slug" text,
  "locale" text NOT NULL DEFAULT 'ko-KR',
  "title" text,
  "body" text,
  "cta_label" text,
  "cta_href" text,
  "content" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "published_by_user_id" uuid,
  "archived_by_user_id" uuid,
  "published_at" timestamptz(6),
  "archived_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "uq_site_content_entries_key_locale"
  ON "site_content_entries" ("content_key", "locale");

CREATE INDEX "idx_site_content_entries_status_locale"
  ON "site_content_entries" ("status", "locale");

CREATE INDEX "idx_site_content_entries_scope_page_status"
  ON "site_content_entries" ("scope", "page_key", "status");

CREATE INDEX "idx_site_content_entries_character_status"
  ON "site_content_entries" ("character_slug", "status");

CREATE INDEX "idx_site_content_entries_model_status"
  ON "site_content_entries" ("model_slug", "status");

CREATE TABLE "site_content_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_id" uuid NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" uuid,
  "before" jsonb NOT NULL DEFAULT '{}',
  "after" jsonb NOT NULL DEFAULT '{}',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "site_content_audit_logs_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "site_content_entries" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_site_content_audit_entry_created"
  ON "site_content_audit_logs" ("entry_id", "created_at");

CREATE INDEX "idx_site_content_audit_actor_created"
  ON "site_content_audit_logs" ("actor_user_id", "created_at");
