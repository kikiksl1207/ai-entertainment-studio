-- Candidate only. Do not apply until the continuity persistence review is approved.

CREATE UNIQUE INDEX "uq_story_analysis_jobs_id_version"
  ON "story_analysis_jobs"("id", "analysis_version");
CREATE UNIQUE INDEX "uq_story_analysis_evidence_job_id"
  ON "story_analysis_evidence"("analysis_job_id", "id");
CREATE UNIQUE INDEX "uq_story_continuity_entries_job_id"
  ON "story_continuity_entries"("analysis_job_id", "id");
CREATE UNIQUE INDEX "uq_story_continuity_issues_job_id"
  ON "story_continuity_issues"("analysis_job_id", "id");

ALTER TABLE "story_continuity_entries" ADD COLUMN "analysis_version" INTEGER;
UPDATE "story_continuity_entries" AS entry
SET "analysis_version" = job."analysis_version"
FROM "story_analysis_jobs" AS job
WHERE job."id" = entry."analysis_job_id";
ALTER TABLE "story_continuity_entries" ALTER COLUMN "analysis_version" SET NOT NULL;

ALTER TABLE "story_continuity_issues"
  ADD COLUMN "analysis_version" INTEGER,
  ADD COLUMN "path_scope" TEXT NOT NULL DEFAULT 'author_original',
  ADD COLUMN "path_key" TEXT NOT NULL DEFAULT 'author_original',
  ADD COLUMN "decision_revision" INTEGER NOT NULL DEFAULT 0;
UPDATE "story_continuity_issues" AS issue
SET "analysis_version" = job."analysis_version"
FROM "story_analysis_jobs" AS job
WHERE job."id" = issue."analysis_job_id";
ALTER TABLE "story_continuity_issues" ALTER COLUMN "analysis_version" SET NOT NULL;

ALTER TABLE "story_continuity_entries"
  ADD CONSTRAINT "story_continuity_entries_job_version_fkey"
  FOREIGN KEY ("analysis_job_id", "analysis_version")
  REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_continuity_entries_type_check"
  CHECK ("entry_type" IN ('foreshadow', 'entity', 'event', 'payoff'));

ALTER TABLE "story_continuity_issues"
  ADD CONSTRAINT "story_continuity_issues_job_version_fkey"
  FOREIGN KEY ("analysis_job_id", "analysis_version")
  REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_continuity_issues_severity_check"
  CHECK ("severity" IN ('critical', 'warning')),
  ADD CONSTRAINT "story_continuity_issues_status_check"
  CHECK ("status" IN ('open', 'accepted', 'resolved', 'dismissed')),
  ADD CONSTRAINT "story_continuity_issues_path_scope_check"
  CHECK (
    ("path_scope" = 'author_original' AND "path_key" = 'author_original') OR
    ("path_scope" = 'reader_derived' AND length("path_key") > 0)
  );

CREATE TABLE "story_continuity_entry_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "analysis_job_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL,
  "entry_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_entry_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_continuity_entry_evidence_entry_id_evidence_id_key" UNIQUE ("entry_id", "evidence_id"),
  CONSTRAINT "story_continuity_entry_evidence_job_version_fkey"
    FOREIGN KEY ("analysis_job_id", "analysis_version")
    REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_entry_evidence_entry_job_fkey"
    FOREIGN KEY ("analysis_job_id", "entry_id")
    REFERENCES "story_continuity_entries"("analysis_job_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_entry_evidence_evidence_job_fkey"
    FOREIGN KEY ("analysis_job_id", "evidence_id")
    REFERENCES "story_analysis_evidence"("analysis_job_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_story_continuity_entry_evidence_job"
  ON "story_continuity_entry_evidence"("analysis_job_id", "entry_id");

CREATE TABLE "story_continuity_issue_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "analysis_job_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL,
  "issue_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_issue_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_continuity_issue_evidence_issue_id_evidence_id_key" UNIQUE ("issue_id", "evidence_id"),
  CONSTRAINT "story_continuity_issue_evidence_job_version_fkey"
    FOREIGN KEY ("analysis_job_id", "analysis_version")
    REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_issue_evidence_issue_job_fkey"
    FOREIGN KEY ("analysis_job_id", "issue_id")
    REFERENCES "story_continuity_issues"("analysis_job_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_issue_evidence_evidence_job_fkey"
    FOREIGN KEY ("analysis_job_id", "evidence_id")
    REFERENCES "story_analysis_evidence"("analysis_job_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_story_continuity_issue_evidence_job"
  ON "story_continuity_issue_evidence"("analysis_job_id", "issue_id");

CREATE TABLE "story_continuity_path_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "analysis_job_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL,
  "entry_id" UUID NOT NULL,
  "path_scope" TEXT NOT NULL,
  "path_key" TEXT NOT NULL,
  "reader_progress_id" UUID,
  "state" TEXT NOT NULL DEFAULT 'observed',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_path_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_continuity_path_states_job_entry_scope_key_key"
    UNIQUE ("analysis_job_id", "entry_id", "path_scope", "path_key"),
  CONSTRAINT "story_continuity_path_states_job_version_fkey"
    FOREIGN KEY ("analysis_job_id", "analysis_version")
    REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_path_states_entry_job_fkey"
    FOREIGN KEY ("analysis_job_id", "entry_id")
    REFERENCES "story_continuity_entries"("analysis_job_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_path_states_progress_fkey"
    FOREIGN KEY ("reader_progress_id")
    REFERENCES "story_reader_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_path_states_scope_check" CHECK (
    ("path_scope" = 'author_original' AND "path_key" = 'author_original' AND "reader_progress_id" IS NULL) OR
    ("path_scope" = 'reader_derived' AND "reader_progress_id" IS NOT NULL AND "path_key" = "reader_progress_id"::text)
  )
);
CREATE INDEX "idx_story_continuity_path_states_work"
  ON "story_continuity_path_states"("work_id", "path_scope", "path_key");

CREATE TABLE "story_continuity_decision_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_id" UUID NOT NULL,
  "analysis_job_id" UUID NOT NULL,
  "analysis_version" INTEGER NOT NULL,
  "issue_id" UUID NOT NULL,
  "decision_revision" INTEGER NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_continuity_decision_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_continuity_decision_audits_issue_revision_key" UNIQUE ("issue_id", "decision_revision"),
  CONSTRAINT "story_continuity_decisions_job_version_fkey"
    FOREIGN KEY ("analysis_job_id", "analysis_version")
    REFERENCES "story_analysis_jobs"("id", "analysis_version") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_decisions_issue_job_fkey"
    FOREIGN KEY ("analysis_job_id", "issue_id")
    REFERENCES "story_continuity_issues"("analysis_job_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_decisions_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_continuity_decisions_status_check"
    CHECK ("from_status" IN ('open', 'accepted', 'resolved', 'dismissed') AND "to_status" IN ('accepted', 'resolved', 'dismissed'))
);
CREATE INDEX "idx_story_continuity_decisions_job_issue"
  ON "story_continuity_decision_audits"("analysis_job_id", "issue_id");

INSERT INTO "story_continuity_entry_evidence" (
  "analysis_job_id", "analysis_version", "entry_id", "evidence_id"
)
SELECT entry."analysis_job_id", entry."analysis_version", entry."id", evidence."id"
FROM "story_continuity_entries" AS entry
CROSS JOIN LATERAL jsonb_array_elements_text(entry."evidence_ids") AS source("evidence_id")
JOIN "story_analysis_evidence" AS evidence
  ON evidence."analysis_job_id" = entry."analysis_job_id"
 AND evidence."id"::text = source."evidence_id";

INSERT INTO "story_continuity_issue_evidence" (
  "analysis_job_id", "analysis_version", "issue_id", "evidence_id"
)
SELECT issue."analysis_job_id", issue."analysis_version", issue."id", evidence."id"
FROM "story_continuity_issues" AS issue
CROSS JOIN LATERAL jsonb_array_elements_text(issue."evidence_ids") AS source("evidence_id")
JOIN "story_analysis_evidence" AS evidence
  ON evidence."analysis_job_id" = issue."analysis_job_id"
 AND evidence."id"::text = source."evidence_id";

INSERT INTO "story_continuity_path_states" (
  "work_id", "analysis_job_id", "analysis_version", "entry_id", "path_scope", "path_key", "state"
)
SELECT "work_id", "analysis_job_id", "analysis_version", "id", 'author_original', 'author_original', "state"
FROM "story_continuity_entries";

UPDATE "story_continuity_issues"
SET "decision_revision" = 1
WHERE "author_decision" IS NOT NULL AND "decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL;

INSERT INTO "story_continuity_decision_audits" (
  "work_id", "analysis_job_id", "analysis_version", "issue_id", "decision_revision",
  "from_status", "to_status", "decision", "actor_user_id", "created_at"
)
SELECT
  "work_id", "analysis_job_id", "analysis_version", "id", 1,
  'open', "status", "author_decision", "decided_by_user_id", "decided_at"
FROM "story_continuity_issues"
WHERE "decision_revision" = 1;

CREATE FUNCTION "reject_story_continuity_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'story continuity history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "story_continuity_entry_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "story_continuity_entry_evidence"
  FOR EACH ROW EXECUTE FUNCTION "reject_story_continuity_history_mutation"();
CREATE TRIGGER "story_continuity_issue_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "story_continuity_issue_evidence"
  FOR EACH ROW EXECUTE FUNCTION "reject_story_continuity_history_mutation"();
CREATE TRIGGER "story_continuity_decision_audits_append_only"
  BEFORE UPDATE OR DELETE ON "story_continuity_decision_audits"
  FOR EACH ROW EXECUTE FUNCTION "reject_story_continuity_history_mutation"();
