CREATE TABLE "story_works" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "owner_user_id" UUID NOT NULL,
  "slug" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "default_locale" TEXT NOT NULL DEFAULT 'ko', "supported_locales" JSONB NOT NULL DEFAULT '[]',
  "title" JSONB NOT NULL, "summary" JSONB NOT NULL, "cover_manifest" JSONB NOT NULL DEFAULT '{}',
  "price_lumina" DECIMAL(18,2) NOT NULL DEFAULT 0, "fixture_source" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_works_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_works_slug_key" ON "story_works"("slug");
CREATE INDEX "idx_story_works_public_catalog" ON "story_works"("status", "published_at", "id");
CREATE INDEX "idx_story_works_owner_updated" ON "story_works"("owner_user_id", "updated_at");

CREATE TABLE "story_parts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL,
  "season_key" TEXT NOT NULL DEFAULT 'season-1', "position" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft', "title" JSONB NOT NULL,
  "price_lumina" DECIMAL(18,2) NOT NULL DEFAULT 0, "fixture_source" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_parts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_parts_work_id_position_key" ON "story_parts"("work_id", "position");
CREATE INDEX "idx_story_parts_work_season" ON "story_parts"("work_id", "season_key", "status", "position");

CREATE TABLE "story_scenes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "part_id" UUID NOT NULL,
  "scene_key" TEXT NOT NULL, "position" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "title" JSONB NOT NULL, "visual_manifest" JSONB NOT NULL DEFAULT '{}', "ending_type" TEXT,
  "fixture_source" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_scenes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_scenes_part_id_scene_key_key" ON "story_scenes"("part_id", "scene_key");
CREATE INDEX "idx_story_scenes_part_position" ON "story_scenes"("part_id", "status", "position");

CREATE TABLE "story_beats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "scene_id" UUID NOT NULL,
  "position" INTEGER NOT NULL, "beat_type" TEXT NOT NULL, "content" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_beats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_beats_scene_id_position_key" ON "story_beats"("scene_id", "position");
CREATE INDEX "idx_story_beats_scene_position" ON "story_beats"("scene_id", "position");

CREATE TABLE "story_choices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "scene_id" UUID NOT NULL,
  "choice_key" TEXT NOT NULL, "position" INTEGER NOT NULL, "label" JSONB NOT NULL,
  "target_scene_id" UUID, "target_ending_key" TEXT, "declared_rejoin_scene_id" UUID,
  "route_kind" TEXT NOT NULL DEFAULT 'branch', "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_choices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_choices_scene_id_choice_key_key" ON "story_choices"("scene_id", "choice_key");
CREATE INDEX "idx_story_choices_scene_position" ON "story_choices"("scene_id", "position");
CREATE INDEX "idx_story_choices_target_scene" ON "story_choices"("target_scene_id");

CREATE TABLE "story_reader_progress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "work_id" UUID NOT NULL,
  "current_scene_id" UUID, "current_beat_position" INTEGER NOT NULL DEFAULT 0,
  "checkpoint_scene_id" UUID, "path_summary" JSONB NOT NULL DEFAULT '[]',
  "seen_scene_ids" JSONB NOT NULL DEFAULT '[]', "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_reader_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_reader_progress_user_id_work_id_key" ON "story_reader_progress"("user_id", "work_id");
CREATE INDEX "idx_story_progress_user_updated" ON "story_reader_progress"("user_id", "updated_at");

CREATE TABLE "story_choice_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "progress_id" UUID NOT NULL,
  "scene_id" UUID NOT NULL, "choice_id" UUID NOT NULL, "target_scene_id" UUID,
  "ending_key" TEXT, "ending_type" TEXT, "explicit_rejoin" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_choice_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_story_choice_events_progress" ON "story_choice_events"("progress_id", "created_at");

CREATE TABLE "story_manuscript_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "owner_user_id" UUID NOT NULL,
  "version" INTEGER NOT NULL, "locale" TEXT NOT NULL, "content_hash" TEXT NOT NULL,
  "structured_body" JSONB NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_manuscript_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_manuscript_versions_work_id_version_key" ON "story_manuscript_versions"("work_id", "version");
CREATE UNIQUE INDEX "story_manuscript_versions_work_id_content_hash_key" ON "story_manuscript_versions"("work_id", "content_hash");
CREATE INDEX "idx_story_manuscripts_owner_created" ON "story_manuscript_versions"("owner_user_id", "created_at");

CREATE TABLE "story_analysis_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "manuscript_version_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL, "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued', "result" JSONB NOT NULL DEFAULT '{}', "error_code" TEXT,
  "started_at" TIMESTAMPTZ(6), "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_analysis_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_analysis_jobs_idempotency_key_key" ON "story_analysis_jobs"("idempotency_key");
CREATE UNIQUE INDEX "story_analysis_jobs_manuscript_version_id_analysis_version_key" ON "story_analysis_jobs"("manuscript_version_id", "analysis_version");
CREATE INDEX "idx_story_analysis_manuscript" ON "story_analysis_jobs"("manuscript_version_id", "created_at");

CREATE TABLE "story_analysis_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "analysis_job_id" UUID NOT NULL,
  "evidence_type" TEXT NOT NULL, "source_part_key" TEXT NOT NULL,
  "source_paragraph_index" INTEGER NOT NULL, "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_analysis_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_story_analysis_evidence_job_type" ON "story_analysis_evidence"("analysis_job_id", "evidence_type");

CREATE TABLE "story_continuity_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "analysis_job_id" UUID NOT NULL,
  "entry_type" TEXT NOT NULL, "ledger_key" TEXT NOT NULL, "label" TEXT NOT NULL,
  "evidence_ids" JSONB NOT NULL DEFAULT '[]', "state" TEXT NOT NULL DEFAULT 'observed',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_continuity_entries_analysis_job_id_entry_type_ledger_key_key" ON "story_continuity_entries"("analysis_job_id", "entry_type", "ledger_key");
CREATE INDEX "idx_story_continuity_entries_work" ON "story_continuity_entries"("work_id", "entry_type", "state");

CREATE TABLE "story_continuity_issues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "work_id" UUID NOT NULL, "analysis_job_id" UUID NOT NULL,
  "issue_key" TEXT NOT NULL, "severity" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'open',
  "summary" TEXT NOT NULL, "evidence_ids" JSONB NOT NULL DEFAULT '[]', "author_decision" TEXT,
  "decided_by_user_id" UUID, "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_issues_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_continuity_issues_analysis_job_id_issue_key_key" ON "story_continuity_issues"("analysis_job_id", "issue_key");
CREATE INDEX "idx_story_continuity_issues_publish" ON "story_continuity_issues"("work_id", "severity", "status");

ALTER TABLE "story_works" ADD CONSTRAINT "story_works_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_parts" ADD CONSTRAINT "story_parts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "story_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_beats" ADD CONSTRAINT "story_beats_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_choices" ADD CONSTRAINT "story_choices_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_choices" ADD CONSTRAINT "story_choices_target_scene_id_fkey" FOREIGN KEY ("target_scene_id") REFERENCES "story_scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_choices" ADD CONSTRAINT "story_choices_declared_rejoin_scene_id_fkey" FOREIGN KEY ("declared_rejoin_scene_id") REFERENCES "story_scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_reader_progress" ADD CONSTRAINT "story_reader_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_reader_progress" ADD CONSTRAINT "story_reader_progress_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_choice_events" ADD CONSTRAINT "story_choice_events_progress_id_fkey" FOREIGN KEY ("progress_id") REFERENCES "story_reader_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_manuscript_versions" ADD CONSTRAINT "story_manuscript_versions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "story_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_analysis_jobs" ADD CONSTRAINT "story_analysis_jobs_manuscript_version_id_fkey" FOREIGN KEY ("manuscript_version_id") REFERENCES "story_manuscript_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_analysis_evidence" ADD CONSTRAINT "story_analysis_evidence_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_continuity_entries" ADD CONSTRAINT "story_continuity_entries_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_continuity_issues" ADD CONSTRAINT "story_continuity_issues_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "story_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
