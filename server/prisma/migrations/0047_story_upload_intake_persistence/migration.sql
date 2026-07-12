CREATE TABLE "story_upload_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "request_key_hash" VARCHAR(64) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "submission_type" VARCHAR(32) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "original_locale" VARCHAR(16) NOT NULL,
    "source_class" VARCHAR(32) NOT NULL,
    "rights_reference" VARCHAR(200),
    "status" VARCHAR(32) NOT NULL DEFAULT 'received',
    "total_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_upload_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_upload_submission_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "category" VARCHAR(24) NOT NULL,
    "position" INTEGER NOT NULL,
    "extension" VARCHAR(12) NOT NULL,
    "client_file_name_hash" VARCHAR(64) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "storage_provider" VARCHAR(16) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_upload_submission_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_upload_submissions_user_request_key"
ON "story_upload_submissions"("user_id", "request_key_hash");

CREATE INDEX "idx_story_upload_submissions_user_status_created"
ON "story_upload_submissions"("user_id", "status", "created_at");

CREATE UNIQUE INDEX "story_upload_files_submission_category_position"
ON "story_upload_submission_files"("submission_id", "category", "position");

CREATE INDEX "idx_story_upload_files_submission"
ON "story_upload_submission_files"("submission_id");

ALTER TABLE "story_upload_submissions"
ADD CONSTRAINT "story_upload_submissions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_upload_submission_files"
ADD CONSTRAINT "story_upload_submission_files_submission_id_fkey"
FOREIGN KEY ("submission_id") REFERENCES "story_upload_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
