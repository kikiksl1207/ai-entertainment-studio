CREATE TABLE "fan_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "artist_id" uuid,
  "slug" text NOT NULL UNIQUE,
  "mission_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "surfaces" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "reset_policy" text NOT NULL DEFAULT 'daily',
  "action_type" text,
  "action_target_id" uuid,
  "reward_policy" jsonb NOT NULL DEFAULT '{}',
  "copy" jsonb NOT NULL DEFAULT '{}',
  "starts_at" timestamptz(6),
  "ends_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fan_missions_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
);

CREATE INDEX "idx_fan_missions_status_window" ON "fan_missions" ("status", "starts_at", "ends_at");
CREATE INDEX "idx_fan_missions_artist_status" ON "fan_missions" ("artist_id", "status");
CREATE INDEX "idx_fan_missions_action_target" ON "fan_missions" ("action_type", "action_target_id");

CREATE TABLE "fan_mission_participations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "mission_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "artist_id" uuid,
  "participation_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'accepted',
  "moderation_status" text NOT NULL DEFAULT 'not_required',
  "reset_bucket" text NOT NULL,
  "source_type" text,
  "source_id" uuid,
  "idempotency_key" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fan_mission_participations_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "fan_missions"("id"),
  CONSTRAINT "fan_mission_participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "fan_mission_participations_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
);

CREATE UNIQUE INDEX "uq_fan_mission_participations_reset" ON "fan_mission_participations" ("mission_id", "user_id", "reset_bucket");
CREATE UNIQUE INDEX "uq_fan_mission_participations_idempotency" ON "fan_mission_participations" ("user_id", "idempotency_key");
CREATE INDEX "idx_fan_mission_participations_user_created" ON "fan_mission_participations" ("user_id", "created_at");
CREATE INDEX "idx_fan_mission_participations_mission_status" ON "fan_mission_participations" ("mission_id", "status");

CREATE TABLE "concept_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "artist_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "visibility" text NOT NULL DEFAULT 'public',
  "copy" jsonb NOT NULL DEFAULT '{}',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "starts_at" timestamptz(6),
  "ends_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "concept_votes_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id")
);

CREATE INDEX "idx_concept_votes_artist_status" ON "concept_votes" ("artist_id", "status");
CREATE INDEX "idx_concept_votes_status_window" ON "concept_votes" ("status", "starts_at", "ends_at");

CREATE TABLE "concept_vote_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vote_id" uuid NOT NULL,
  "option_key" text NOT NULL,
  "copy" jsonb NOT NULL DEFAULT '{}',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "concept_vote_options_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "concept_votes"("id")
);

CREATE UNIQUE INDEX "uq_concept_vote_options_key" ON "concept_vote_options" ("vote_id", "option_key");
CREATE INDEX "idx_concept_vote_options_vote_sort" ON "concept_vote_options" ("vote_id", "sort_order");

CREATE TABLE "concept_vote_ballots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vote_id" uuid NOT NULL,
  "option_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "mission_id" uuid,
  "idempotency_key" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "concept_vote_ballots_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "concept_votes"("id"),
  CONSTRAINT "concept_vote_ballots_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "concept_vote_options"("id"),
  CONSTRAINT "concept_vote_ballots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "uq_concept_vote_ballots_user_vote" ON "concept_vote_ballots" ("vote_id", "user_id");
CREATE UNIQUE INDEX "uq_concept_vote_ballots_idempotency" ON "concept_vote_ballots" ("user_id", "idempotency_key");
CREATE INDEX "idx_concept_vote_ballots_vote_created" ON "concept_vote_ballots" ("vote_id", "created_at");

CREATE TABLE "fan_engagement_point_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "points" integer NOT NULL,
  "direction" text NOT NULL,
  "ledger_type" text NOT NULL,
  "reference_type" text NOT NULL,
  "reference_id" uuid NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fan_engagement_point_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "fan_engagement_point_ledger_points_check" CHECK ("points" >= 0),
  CONSTRAINT "fan_engagement_point_ledger_direction_check" CHECK ("direction" IN ('earn', 'spend', 'adjustment'))
);

CREATE UNIQUE INDEX "uq_fan_point_ledger_reference" ON "fan_engagement_point_ledger" ("user_id", "reference_type", "reference_id", "ledger_type");
CREATE INDEX "idx_fan_point_ledger_user_created" ON "fan_engagement_point_ledger" ("user_id", "created_at");
CREATE INDEX "idx_fan_point_ledger_reference" ON "fan_engagement_point_ledger" ("reference_type", "reference_id");

CREATE TABLE "fan_achievements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "category" text NOT NULL,
  "copy" jsonb NOT NULL DEFAULT '{}',
  "badge_icon_key" text,
  "criteria" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX "idx_fan_achievements_status_category" ON "fan_achievements" ("status", "category");

CREATE TABLE "user_fan_achievements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "achievement_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'earned',
  "progress_current" integer NOT NULL DEFAULT 0,
  "progress_target" integer NOT NULL DEFAULT 1,
  "earned_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_fan_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "user_fan_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "fan_achievements"("id")
);

CREATE UNIQUE INDEX "uq_user_fan_achievements_user_achievement" ON "user_fan_achievements" ("user_id", "achievement_id");
CREATE INDEX "idx_user_fan_achievements_user_status" ON "user_fan_achievements" ("user_id", "status");

CREATE TABLE "fan_titles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "rarity" text NOT NULL,
  "copy" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX "idx_fan_titles_status_rarity" ON "fan_titles" ("status", "rarity");

CREATE TABLE "user_fan_titles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "title_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "equipped" boolean NOT NULL DEFAULT false,
  "equipped_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_fan_titles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "user_fan_titles_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "fan_titles"("id")
);

CREATE UNIQUE INDEX "uq_user_fan_titles_user_title" ON "user_fan_titles" ("user_id", "title_id");
CREATE INDEX "idx_user_fan_titles_user_equipped" ON "user_fan_titles" ("user_id", "equipped");
