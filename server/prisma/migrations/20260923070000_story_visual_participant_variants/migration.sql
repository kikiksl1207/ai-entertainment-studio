ALTER TABLE "story_visual_generations"
  ADD COLUMN "variant_key" VARCHAR(80) NOT NULL DEFAULT 'default';

DROP INDEX "uq_story_visual_generations_release_scene";

CREATE UNIQUE INDEX "uq_story_visual_generations_release_scene_variant"
  ON "story_visual_generations"("work_id", "release_id", "source_scene_key", "variant_key");

ALTER TABLE "story_visual_generations"
  ADD CONSTRAINT "story_visual_generations_variant_key_shape"
  CHECK (
    "variant_key" = 'default' OR
    "variant_key" ~ '^artist:[a-f0-9]{64}$'
  );
