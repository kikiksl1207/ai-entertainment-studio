CREATE TABLE artist_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  role text NOT NULL DEFAULT 'owner',
  status text NOT NULL DEFAULT 'active',
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT artist_operators_user_artist_key UNIQUE (user_id, artist_id)
);

CREATE INDEX idx_artist_operators_artist_status
  ON artist_operators(artist_id, status);

CREATE INDEX idx_artist_operators_user_status
  ON artist_operators(user_id, status);

CREATE TABLE community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid REFERENCES artists(id),
  post_type text NOT NULL DEFAULT 'user_post',
  status text NOT NULL DEFAULT 'published',
  visibility text NOT NULL DEFAULT 'public',
  body text NOT NULL,
  like_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_community_posts_public_feed
  ON community_posts(status, visibility, published_at);

CREATE INDEX idx_community_posts_artist_feed
  ON community_posts(artist_id, status, published_at);

CREATE INDEX idx_community_posts_author_feed
  ON community_posts(author_user_id, published_at);

CREATE TABLE community_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES community_posts(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'published',
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_community_replies_post_created
  ON community_replies(post_id, created_at);

CREATE INDEX idx_community_replies_author_created
  ON community_replies(author_user_id, created_at);

CREATE TABLE community_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES community_posts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  reaction_type text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reactions_post_user_type_key UNIQUE (post_id, user_id, reaction_type)
);

CREATE INDEX idx_community_reactions_user_created
  ON community_reactions(user_id, created_at);

CREATE TABLE community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES community_posts(id),
  reporter_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'submitted',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_community_reports_post_status
  ON community_reports(post_id, status);

CREATE INDEX idx_community_reports_reporter_created
  ON community_reports(reporter_user_id, created_at);

CREATE TABLE artist_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT artist_follows_user_artist_key UNIQUE (user_id, artist_id)
);

CREATE INDEX idx_artist_follows_artist_status
  ON artist_follows(artist_id, status);

CREATE INDEX idx_artist_follows_user_status
  ON artist_follows(user_id, status);
