ALTER TABLE "user_settings"
ADD COLUMN "activity_notifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "feed_notifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "email_notifications" BOOLEAN NOT NULL DEFAULT false;
