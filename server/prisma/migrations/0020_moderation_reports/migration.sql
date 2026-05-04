CREATE TABLE "moderation_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reporter_user_id" UUID NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "moderation_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "moderation_reports"
ADD CONSTRAINT "moderation_reports_reporter_user_id_fkey"
FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_moderation_reports_target_status"
ON "moderation_reports"("target_type", "target_id", "status");

CREATE INDEX "idx_moderation_reports_reporter_created"
ON "moderation_reports"("reporter_user_id", "created_at");

CREATE INDEX "idx_moderation_reports_status_created"
ON "moderation_reports"("status", "created_at");
