CREATE TABLE "community_post_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id" uuid NOT NULL REFERENCES "community_posts"("id"),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "role" text NOT NULL DEFAULT 'attachment',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "community_post_assets_post_id_asset_id_role_key"
  ON "community_post_assets"("post_id", "asset_id", "role");

CREATE INDEX "idx_community_post_assets_post_sort"
  ON "community_post_assets"("post_id", "sort_order");

CREATE INDEX "idx_community_post_assets_asset"
  ON "community_post_assets"("asset_id");
