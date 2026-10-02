ALTER TABLE "story_ai_continuations"
  ADD COLUMN "sibling_context_key" VARCHAR(64),
  ADD COLUMN "sibling_choice_key" VARCHAR(64);

-- Historical rows cannot be assigned a choice-independent context without replaying
-- their original approved inputs; new execution requires both versioned keys.

ALTER TABLE "story_ai_continuations"
  ADD CONSTRAINT "story_ai_continuations_sibling_keys_pair"
  CHECK (("sibling_context_key" IS NULL) = ("sibling_choice_key" IS NULL));

CREATE TABLE "story_ai_sibling_narrative_claims" (
  "sibling_context_key" VARCHAR(64) NOT NULL,
  "narrative_checksum" VARCHAR(64) NOT NULL,
  "sibling_choice_key" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_sibling_narrative_claims_pkey"
    PRIMARY KEY ("sibling_context_key", "narrative_checksum")
);
