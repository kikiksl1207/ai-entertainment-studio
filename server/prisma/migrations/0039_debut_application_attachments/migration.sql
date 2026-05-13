CREATE TABLE "debut_application_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "category" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'attached',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "debut_application_attachments_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "debut_applications"("id"),
  CONSTRAINT "debut_application_attachments_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
);

CREATE UNIQUE INDEX "uq_debut_application_attachments_asset_category"
  ON "debut_application_attachments" ("application_id", "asset_id", "category");

CREATE INDEX "idx_debut_application_attachments_application_category"
  ON "debut_application_attachments" ("application_id", "category");

CREATE INDEX "idx_debut_application_attachments_asset"
  ON "debut_application_attachments" ("asset_id");
