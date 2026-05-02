CREATE TABLE monthly_pick_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES boost_campaigns(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  year integer NOT NULL,
  month integer NOT NULL,
  rank_no integer NOT NULL DEFAULT 1,
  total_free_likes numeric(18, 2) NOT NULL DEFAULT 0,
  total_lumina_boosts numeric(18, 2) NOT NULL DEFAULT 0,
  total_weighted_score numeric(18, 4) NOT NULL DEFAULT 0,
  decided_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_pick_winners_year_month_key UNIQUE (year, month)
);

CREATE INDEX idx_monthly_pick_winners_artist_year
  ON monthly_pick_winners(artist_id, year);

CREATE TABLE debut_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'submitted',
  applicant_name text NOT NULL,
  display_name text,
  contact_email text NOT NULL,
  contact_phone text,
  is_adult boolean NOT NULL,
  participation_type text NOT NULL,
  share_tier_requested integer,
  share_tier_approved integer,
  intro text NOT NULL,
  portfolio_url text,
  consent_appearance boolean NOT NULL DEFAULT false,
  consent_voice boolean NOT NULL DEFAULT false,
  consent_revenue_policy boolean NOT NULL DEFAULT false,
  consent_privacy boolean NOT NULL DEFAULT false,
  review_note text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_debut_applications_status_created
  ON debut_applications(status, created_at);

CREATE INDEX idx_debut_applications_user_created
  ON debut_applications(user_id, created_at);
