CREATE TABLE "story_ai_rate_cards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "currency_code" TEXT NOT NULL DEFAULT 'KRW',
  "input_cost_per_million" DECIMAL(18,6) NOT NULL,
  "output_cost_per_million" DECIMAL(18,6) NOT NULL,
  "cached_input_cost_per_million" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "image_unit_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "effective_at" TIMESTAMPTZ(6),
  "retired_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_rate_cards_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "story_reader_progress"
  ADD COLUMN "ai_rate_card_id" UUID,
  ADD COLUMN "capability_revision" INTEGER;

CREATE TABLE "story_pricing_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "rate_card_id" UUID NOT NULL,
  "author_rights_cost_krw" DECIMAL(18,2) NOT NULL,
  "expected_free_replay_count" INTEGER NOT NULL DEFAULT 1,
  "included_new_ai_route_count" INTEGER NOT NULL DEFAULT 0,
  "payment_fee_rate" DECIMAL(8,6) NOT NULL,
  "vat_rate" DECIMAL(8,6) NOT NULL,
  "storage_delivery_cost_krw" DECIMAL(18,2) NOT NULL,
  "operating_margin_rate" DECIMAL(8,6) NOT NULL,
  "warning_budget_krw" DECIMAL(18,2) NOT NULL DEFAULT 3000,
  "hard_budget_krw" DECIMAL(18,2) NOT NULL DEFAULT 4000,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_pricing_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_release_capabilities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "rate_card_id" UUID NOT NULL,
  "fixed_choice_count" INTEGER NOT NULL DEFAULT 3,
  "custom_choice_enabled" BOOLEAN NOT NULL DEFAULT false,
  "custom_choice_max_length" INTEGER NOT NULL DEFAULT 200,
  "full_reset_limit" INTEGER NOT NULL DEFAULT 1,
  "act_reset_limit" INTEGER NOT NULL DEFAULT 3,
  "included_ai_route_count" INTEGER NOT NULL DEFAULT 0,
  "ai_input_token_limit" INTEGER NOT NULL DEFAULT 12000,
  "ai_output_token_limit" INTEGER NOT NULL DEFAULT 2500,
  "warning_budget_krw" DECIMAL(18,2) NOT NULL DEFAULT 3000,
  "hard_budget_krw" DECIMAL(18,2) NOT NULL DEFAULT 4000,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "validation_errors" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_release_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_ai_allowance_buckets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "included_limit" INTEGER NOT NULL DEFAULT 0,
  "purchased_limit" INTEGER NOT NULL DEFAULT 0,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "consumed_count" INTEGER NOT NULL DEFAULT 0,
  "compensated_count" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_allowance_buckets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_ai_continuations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "progress_id" UUID NOT NULL,
  "custom_choice_id" UUID NOT NULL,
  "rate_card_id" UUID NOT NULL,
  "style_consent_id" UUID NOT NULL,
  "capability_revision" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "source_scene_id" UUID NOT NULL,
  "source_progress_revision" INTEGER NOT NULL,
  "checkpoint_scene_id" UUID,
  "context_references" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "failure_code" TEXT,
  "result_scene_id" UUID,
  "estimated_cost_krw" DECIMAL(18,6) NOT NULL,
  "hard_budget_krw" DECIMAL(18,2) NOT NULL,
  "input_token_limit" INTEGER NOT NULL,
  "output_token_limit" INTEGER NOT NULL,
  "actual_cost_krw" DECIMAL(18,6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_ai_continuations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_ai_usage_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "continuation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "rate_card_id" UUID NOT NULL,
  "event_kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "rate_card_version" TEXT NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "image_units" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_krw" DECIMAL(18,6) NOT NULL,
  "actual_cost_krw" DECIMAL(18,6),
  "allowance_delta" INTEGER NOT NULL DEFAULT 0,
  "progress_applied" BOOLEAN NOT NULL DEFAULT false,
  "provenance" TEXT NOT NULL DEFAULT 'ai_generated',
  "idempotency_key" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ai_usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_memory_budget_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "analysis_job_id" UUID,
  "rate_card_id" UUID NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "part_count" INTEGER NOT NULL,
  "estimated_input_tokens" INTEGER NOT NULL,
  "estimated_output_tokens" INTEGER NOT NULL,
  "estimated_cost_krw" DECIMAL(18,6) NOT NULL,
  "actual_cost_krw" DECIMAL(18,6),
  "warning_budget_krw" DECIMAL(18,2) NOT NULL,
  "hard_budget_krw" DECIMAL(18,2) NOT NULL,
  "decision" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_memory_budget_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_style_profile_consents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rights_confirmed" BOOLEAN NOT NULL,
  "ai_branch_allowed" BOOLEAN NOT NULL DEFAULT false,
  "translation_allowed" BOOLEAN NOT NULL DEFAULT false,
  "image_transformation_allowed" BOOLEAN NOT NULL DEFAULT false,
  "allowed_locales" JSONB NOT NULL DEFAULT '[]',
  "allowed_regions" JSONB NOT NULL DEFAULT '[]',
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "public_claim" TEXT NOT NULL DEFAULT 'writer_approved_manuscript_based_ai_expansion',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "withdrawn_at" TIMESTAMPTZ(6),
  "deletion_requested_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_style_profile_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_ai_rate_cards_version_key" ON "story_ai_rate_cards"("version");
CREATE INDEX "idx_story_ai_rate_cards_active" ON "story_ai_rate_cards"("status", "effective_at");
CREATE UNIQUE INDEX "story_pricing_policies_work_id_key" ON "story_pricing_policies"("work_id");
CREATE INDEX "idx_story_pricing_policies_rate_card" ON "story_pricing_policies"("rate_card_id");
CREATE UNIQUE INDEX "story_release_capabilities_release_id_key" ON "story_release_capabilities"("release_id");
CREATE INDEX "idx_story_release_capabilities_work" ON "story_release_capabilities"("work_id", "status");
CREATE INDEX "idx_story_release_capabilities_rate_card" ON "story_release_capabilities"("rate_card_id");
CREATE UNIQUE INDEX "story_ai_allowance_buckets_user_id_release_id_key" ON "story_ai_allowance_buckets"("user_id", "release_id");
CREATE INDEX "idx_story_ai_allowance_user_work" ON "story_ai_allowance_buckets"("user_id", "work_id");
CREATE UNIQUE INDEX "story_ai_continuations_custom_choice_id_key" ON "story_ai_continuations"("custom_choice_id");
CREATE UNIQUE INDEX "story_ai_continuations_idempotency_key_key" ON "story_ai_continuations"("idempotency_key");
CREATE INDEX "idx_story_ai_continuations_progress" ON "story_ai_continuations"("progress_id", "status", "created_at");
CREATE INDEX "idx_story_ai_continuations_release" ON "story_ai_continuations"("work_id", "release_id", "created_at");
CREATE UNIQUE INDEX "story_ai_usage_ledger_idempotency_key_key" ON "story_ai_usage_ledger"("idempotency_key");
CREATE INDEX "idx_story_ai_usage_release" ON "story_ai_usage_ledger"("work_id", "release_id", "occurred_at");
CREATE INDEX "idx_story_ai_usage_user_work" ON "story_ai_usage_ledger"("user_id", "work_id", "occurred_at");
CREATE UNIQUE INDEX "story_memory_budget_runs_idempotency_key_key" ON "story_memory_budget_runs"("idempotency_key");
CREATE INDEX "idx_story_memory_budget_work_scope" ON "story_memory_budget_runs"("work_id", "scope_type", "created_at");
CREATE UNIQUE INDEX "story_style_profile_consents_work_id_key" ON "story_style_profile_consents"("work_id");
CREATE INDEX "idx_story_style_consent_owner_status" ON "story_style_profile_consents"("owner_user_id", "status");
CREATE INDEX "idx_story_style_consent_manuscript" ON "story_style_profile_consents"("manuscript_version_id");
