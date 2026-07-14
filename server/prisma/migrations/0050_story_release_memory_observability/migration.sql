ALTER TABLE "story_works"
  ADD COLUMN "active_release_id" UUID,
  ADD COLUMN "release_revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "story_reader_progress" ADD COLUMN "active_release_id" UUID;

CREATE TABLE "story_releases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'candidate', "manuscript_version_id" UUID NOT NULL,
  "branch_graph_snapshot" JSONB NOT NULL, "ending_set_snapshot" JSONB NOT NULL,
  "scene_asset_manifest" JSONB NOT NULL, "localized_display_snapshot" JSONB NOT NULL,
  "checksum" TEXT NOT NULL, "validation_summary" JSONB NOT NULL DEFAULT '{}',
  "diff_summary" JSONB NOT NULL DEFAULT '{}', "created_by_user_id" UUID NOT NULL,
  "activated_at" TIMESTAMPTZ(6), "retired_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_releases_work_id_version_key" ON "story_releases"("work_id", "version");
CREATE UNIQUE INDEX "story_releases_work_id_checksum_key" ON "story_releases"("work_id", "checksum");
CREATE INDEX "idx_story_releases_work_status" ON "story_releases"("work_id", "status", "created_at");

CREATE TABLE "story_publication_transitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "release_id" UUID,
  "actor_user_id" UUID NOT NULL, "idempotency_key" TEXT NOT NULL,
  "from_status" TEXT NOT NULL, "to_status" TEXT NOT NULL,
  "before_revision" INTEGER NOT NULL, "after_revision" INTEGER NOT NULL,
  "public_summary" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_publication_transitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_publication_transitions_idempotency_key_key" ON "story_publication_transitions"("idempotency_key");
CREATE INDEX "idx_story_publication_transitions_work" ON "story_publication_transitions"("work_id", "created_at");

CREATE TABLE "story_save_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "work_id" UUID NOT NULL,
  "slot_number" INTEGER NOT NULL, "release_id" UUID NOT NULL, "checkpoint_id" UUID,
  "label" TEXT, "revision" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'active',
  "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "cleared_at" TIMESTAMPTZ(6),
  CONSTRAINT "story_save_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_save_slots_number_check" CHECK ("slot_number" BETWEEN 1 AND 9)
);
CREATE UNIQUE INDEX "story_save_slots_user_id_work_id_slot_number_key" ON "story_save_slots"("user_id", "work_id", "slot_number");
CREATE INDEX "idx_story_save_slots_user_work" ON "story_save_slots"("user_id", "work_id", "saved_at");

CREATE TABLE "story_ending_discoveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "work_id" UUID NOT NULL,
  "release_id" UUID NOT NULL, "ending_key" TEXT NOT NULL, "ending_kind" TEXT NOT NULL,
  "path_signature" TEXT NOT NULL, "provenance" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_ending_discoveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_ending_discoveries_user_id_release_id_ending_key_path_signature_key"
  ON "story_ending_discoveries"("user_id", "release_id", "ending_key", "path_signature");
CREATE INDEX "idx_story_endings_user_work" ON "story_ending_discoveries"("user_id", "work_id", "first_seen_at");

CREATE TABLE "story_memory_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL,
  "analysis_job_id" UUID NOT NULL, "manuscript_version_id" UUID NOT NULL,
  "memory_type" TEXT NOT NULL, "memory_key" TEXT NOT NULL, "part_key" TEXT,
  "content" JSONB NOT NULL, "evidence_ids" JSONB NOT NULL DEFAULT '[]',
  "provenance" TEXT NOT NULL DEFAULT 'writer_original', "status" TEXT NOT NULL DEFAULT 'approved',
  "revision" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_memory_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_memory_records_analysis_job_id_memory_type_memory_key_key"
  ON "story_memory_records"("analysis_job_id", "memory_type", "memory_key");
CREATE INDEX "idx_story_memory_work_type_part" ON "story_memory_records"("work_id", "memory_type", "part_key");

CREATE TABLE "story_memory_retrieval_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL,
  "analysis_job_id" UUID NOT NULL, "idempotency_key" TEXT NOT NULL,
  "current_part_key" TEXT NOT NULL, "retrieval_types" JSONB NOT NULL,
  "selected_memory_ids" JSONB NOT NULL DEFAULT '[]', "checkpoint" TEXT NOT NULL DEFAULT 'started',
  "status" TEXT NOT NULL DEFAULT 'running', "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_memory_retrieval_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_memory_retrieval_runs_idempotency_key_key" ON "story_memory_retrieval_runs"("idempotency_key");
CREATE INDEX "idx_story_memory_runs_work_analysis" ON "story_memory_retrieval_runs"("work_id", "analysis_job_id", "created_at");

CREATE TABLE "story_writer_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "owner_user_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL, "analysis_job_id" UUID NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'editing', "revision" INTEGER NOT NULL DEFAULT 1,
  "decisions" JSONB NOT NULL DEFAULT '{}', "final_summary" JSONB NOT NULL DEFAULT '{}',
  "submitted_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_writer_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_writer_reviews_work_id_manuscript_version_id_analysis_job_id_key"
  ON "story_writer_reviews"("work_id", "manuscript_version_id", "analysis_job_id");
CREATE INDEX "idx_story_writer_reviews_owner" ON "story_writer_reviews"("owner_user_id", "updated_at");

CREATE TABLE "story_final_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "review_id" UUID NOT NULL,
  "manuscript_version_id" UUID NOT NULL, "idempotency_key" TEXT NOT NULL,
  "checksum" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'submitted',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_final_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_final_submissions_review_id_key" ON "story_final_submissions"("review_id");
CREATE UNIQUE INDEX "story_final_submissions_idempotency_key_key" ON "story_final_submissions"("idempotency_key");

CREATE TABLE "story_quality_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "release_id" UUID,
  "session_key_hash" TEXT NOT NULL, "event_type" TEXT NOT NULL, "metric_bucket" TEXT NOT NULL,
  "dimensions" JSONB NOT NULL DEFAULT '{}', "numeric_value" DECIMAL(18,6),
  "idempotency_key" TEXT NOT NULL, "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_quality_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_quality_events_idempotency_key_key" ON "story_quality_events"("idempotency_key");
CREATE INDEX "idx_story_quality_events_work_release" ON "story_quality_events"("work_id", "release_id", "event_type", "occurred_at");

CREATE TABLE "story_quality_aggregates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "release_id" UUID NOT NULL,
  "metric_key" TEXT NOT NULL, "sample_count" INTEGER NOT NULL,
  "numerator" DECIMAL(18,6), "denominator" DECIMAL(18,6), "measured_value" DECIMAL(18,6),
  "measured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_quality_aggregates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_quality_aggregates_work_id_release_id_metric_key_key"
  ON "story_quality_aggregates"("work_id", "release_id", "metric_key");
CREATE INDEX "idx_story_quality_aggregates_work" ON "story_quality_aggregates"("work_id", "measured_at");

ALTER TABLE "story_works" ADD CONSTRAINT "story_works_active_release_id_fkey" FOREIGN KEY ("active_release_id") REFERENCES "story_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "story_reader_progress" ADD CONSTRAINT "story_reader_progress_active_release_id_fkey" FOREIGN KEY ("active_release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_releases" ADD CONSTRAINT "story_releases_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_releases" ADD CONSTRAINT "story_releases_manuscript_version_id_fkey" FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_releases" ADD CONSTRAINT "story_releases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_publication_transitions" ADD CONSTRAINT "story_publication_transitions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_publication_transitions" ADD CONSTRAINT "story_publication_transitions_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_publication_transitions" ADD CONSTRAINT "story_publication_transitions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_save_slots" ADD CONSTRAINT "story_save_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_save_slots" ADD CONSTRAINT "story_save_slots_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_save_slots" ADD CONSTRAINT "story_save_slots_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_save_slots" ADD CONSTRAINT "story_save_slots_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "story_progress_checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "story_ending_discoveries" ADD CONSTRAINT "story_ending_discoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_ending_discoveries" ADD CONSTRAINT "story_ending_discoveries_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_ending_discoveries" ADD CONSTRAINT "story_ending_discoveries_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_memory_records" ADD CONSTRAINT "story_memory_records_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_memory_records" ADD CONSTRAINT "story_memory_records_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_memory_records" ADD CONSTRAINT "story_memory_records_manuscript_version_id_fkey" FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_memory_retrieval_runs" ADD CONSTRAINT "story_memory_retrieval_runs_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_memory_retrieval_runs" ADD CONSTRAINT "story_memory_retrieval_runs_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_writer_reviews" ADD CONSTRAINT "story_writer_reviews_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_writer_reviews" ADD CONSTRAINT "story_writer_reviews_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_writer_reviews" ADD CONSTRAINT "story_writer_reviews_manuscript_version_id_fkey" FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_writer_reviews" ADD CONSTRAINT "story_writer_reviews_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_final_submissions" ADD CONSTRAINT "story_final_submissions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "story_writer_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_final_submissions" ADD CONSTRAINT "story_final_submissions_manuscript_version_id_fkey" FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_quality_events" ADD CONSTRAINT "story_quality_events_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_quality_events" ADD CONSTRAINT "story_quality_events_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_quality_aggregates" ADD CONSTRAINT "story_quality_aggregates_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_quality_aggregates" ADD CONSTRAINT "story_quality_aggregates_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "story_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
