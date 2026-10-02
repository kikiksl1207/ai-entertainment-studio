ALTER TABLE "story_publication_choice_batches"
  ADD COLUMN "preparation_context" JSONB,
  ADD COLUMN "preparation_context_sha256" VARCHAR(64);

-- Existing attempts cannot be assigned an inferred contiguous part range.
ALTER TABLE "story_publication_choice_batches"
  ADD CONSTRAINT "story_publication_choice_batches_context_pair"
  CHECK (
    ("preparation_context" IS NULL AND "preparation_context_sha256" IS NULL)
    OR
    ("preparation_context" IS NOT NULL AND "preparation_context_sha256" IS NOT NULL
      AND jsonb_typeof("preparation_context") = 'object'
      AND "preparation_context_sha256" ~ '^[a-f0-9]{64}$')
  );
