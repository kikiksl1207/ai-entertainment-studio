ALTER TABLE debut_applications
  ADD COLUMN IF NOT EXISTS consent_marketing boolean NOT NULL DEFAULT false;
