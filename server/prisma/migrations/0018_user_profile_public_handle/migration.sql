ALTER TABLE "user_profiles"
ADD COLUMN "public_handle" TEXT;

UPDATE "user_profiles"
SET "public_handle" = 'user-' || replace("user_id"::text, '-', '')
WHERE "public_handle" IS NULL;

ALTER TABLE "user_profiles"
ALTER COLUMN "public_handle" SET NOT NULL;

CREATE UNIQUE INDEX "user_profiles_public_handle_key"
ON "user_profiles"("public_handle");
