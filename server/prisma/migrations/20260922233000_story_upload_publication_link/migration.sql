ALTER TABLE "story_upload_submissions"
ADD COLUMN "promoted_work_id" UUID;

CREATE UNIQUE INDEX "story_upload_submissions_promoted_work_id_key"
ON "story_upload_submissions"("promoted_work_id");
