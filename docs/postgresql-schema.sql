CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  email text UNIQUE,
  phone_number text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE user_auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('email', 'google', 'apple', 'kakao', 'naver')),
  provider_user_id text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  display_name text NOT NULL,
  avatar_asset_id uuid,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  locale text NOT NULL DEFAULT 'ko-KR',
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  marketing_opt_in boolean NOT NULL DEFAULT false,
  push_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  sort_order integer NOT NULL DEFAULT 0,
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_public_profiles (
  artist_id uuid PRIMARY KEY REFERENCES artists(id),
  tagline text,
  summary text,
  personality_keywords text[] NOT NULL DEFAULT '{}',
  public_story text,
  public_metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_visual_profiles (
  artist_id uuid PRIMARY KEY REFERENCES artists(id),
  visual_keywords text[] NOT NULL DEFAULT '{}',
  style_notes text,
  primary_color text,
  secondary_color text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_content_profiles (
  artist_id uuid PRIMARY KEY REFERENCES artists(id),
  content_tone text,
  allowed_topics text[] NOT NULL DEFAULT '{}',
  blocked_topics text[] NOT NULL DEFAULT '{}',
  operating_notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('image', 'video', 'audio', 'document', 'thumbnail')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private', 'premium')),
  storage_provider text NOT NULL DEFAULT 'local',
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_seconds numeric(12,3) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_provider, storage_key)
);

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_avatar_asset
  FOREIGN KEY (avatar_asset_id) REFERENCES assets(id);

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  storage_key text NOT NULL,
  change_note text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version_no)
);

CREATE TABLE artist_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  usage_type text NOT NULL CHECK (usage_type IN ('cover', 'thumb', 'profile', 'gallery', 'outfit', 'item', 'reaction', 'premium_video', 'shortform')),
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artist_id, asset_id, usage_type)
);

CREATE TABLE shortforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid REFERENCES artists(id),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shortform_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shortform_id uuid NOT NULL REFERENCES shortforms(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  role text NOT NULL CHECK (role IN ('video', 'thumbnail', 'subtitle', 'source')),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (shortform_id, asset_id, role)
);

CREATE TABLE shortform_metrics_daily (
  shortform_id uuid NOT NULL REFERENCES shortforms(id),
  metric_date date NOT NULL,
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
  likes bigint NOT NULL DEFAULT 0 CHECK (likes >= 0),
  shares bigint NOT NULL DEFAULT 0 CHECK (shares >= 0),
  comments bigint NOT NULL DEFAULT 0 CHECK (comments >= 0),
  watch_seconds bigint NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0),
  PRIMARY KEY (shortform_id, metric_date)
);

CREATE TABLE wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  currency_code text NOT NULL DEFAULT 'LUMINA',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  cached_balance numeric(18,2) NOT NULL DEFAULT 0 CHECK (cached_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency_code)
);

CREATE TABLE wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id),
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  ledger_type text NOT NULL CHECK (ledger_type IN ('purchase', 'gift_spend', 'boost_spend', 'chat_feature_spend', 'premium_video_spend', 'refund', 'adjustment', 'event_grant', 'hold_capture', 'hold_release')),
  reference_type text,
  reference_id uuid,
  idempotency_key text UNIQUE,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'captured', 'released', 'expired')),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lumina_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  lumina_amount numeric(18,2) NOT NULL CHECK (lumina_amount > 0),
  bonus_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  price_amount numeric(18,2) NOT NULL CHECK (price_amount >= 0),
  price_currency text NOT NULL DEFAULT 'KRW',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  lumina_product_id uuid NOT NULL REFERENCES lumina_products(id),
  order_no text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'mock',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'KRW',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL REFERENCES payment_orders(id),
  provider text NOT NULL,
  provider_transaction_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'paid', 'failed', 'cancelled')),
  raw_payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id)
);

CREATE TABLE refund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL REFERENCES payment_orders(id),
  provider_refund_id text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gift_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid REFERENCES artists(id),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  gift_kind text NOT NULL CHECK (gift_kind IN ('instant', 'progressive')),
  price_lumina numeric(18,2) NOT NULL CHECK (price_lumina > 0),
  progress_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (progress_amount >= 0),
  target_amount numeric(18,2) CHECK (target_amount IS NULL OR target_amount > 0),
  unlock_asset_id uuid REFERENCES assets(id),
  reaction_asset_id uuid REFERENCES assets(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (gift_kind = 'instant' AND progress_amount = 0 AND target_amount IS NULL)
    OR
    (gift_kind = 'progressive' AND progress_amount > 0 AND target_amount IS NOT NULL)
  )
);

CREATE TABLE gift_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  gift_product_id uuid NOT NULL REFERENCES gift_products(id),
  wallet_ledger_id uuid REFERENCES wallet_ledger(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_lumina numeric(18,2) NOT NULL CHECK (total_lumina > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_gift_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id),
  gift_product_id uuid NOT NULL REFERENCES gift_products(id),
  current_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_amount numeric(18,2) NOT NULL CHECK (target_amount > 0),
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artist_id, gift_product_id)
);

CREATE TABLE artist_reaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id),
  gift_order_id uuid REFERENCES gift_orders(id),
  reaction_type text NOT NULL CHECK (reaction_type IN ('gift_instant', 'gift_progress', 'gift_unlock', 'chat_feature')),
  asset_id uuid REFERENCES assets(id),
  message text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_equipped_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id),
  source_gift_product_id uuid REFERENCES gift_products(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  slot text NOT NULL CHECK (slot IN ('outfit', 'accessory', 'background', 'prop', 'voice', 'other')),
  status text NOT NULL DEFAULT 'equipped' CHECK (status IN ('equipped', 'available', 'removed')),
  equipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boost_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  free_like_weight numeric(12,4) NOT NULL DEFAULT 1 CHECK (free_like_weight >= 0),
  lumina_boost_weight numeric(12,4) NOT NULL DEFAULT 1 CHECK (lumina_boost_weight >= 0),
  daily_free_like_limit integer CHECK (daily_free_like_limit IS NULL OR daily_free_like_limit > 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE boost_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  boost_amount numeric(18,2) NOT NULL CHECK (boost_amount > 0),
  price_lumina numeric(18,2) NOT NULL CHECK (price_lumina > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_boost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES boost_campaigns(id),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  boost_type text NOT NULL CHECK (boost_type IN ('free_like', 'lumina_boost', 'admin_grant')),
  boost_product_id uuid REFERENCES boost_products(id),
  wallet_ledger_id uuid REFERENCES wallet_ledger(id),
  raw_amount numeric(18,2) NOT NULL CHECK (raw_amount > 0),
  weighted_score numeric(18,4) NOT NULL CHECK (weighted_score >= 0),
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (boost_type = 'free_like' AND boost_product_id IS NULL AND wallet_ledger_id IS NULL)
    OR
    (boost_type = 'lumina_boost' AND boost_product_id IS NOT NULL AND wallet_ledger_id IS NOT NULL)
    OR
    (boost_type = 'admin_grant' AND wallet_ledger_id IS NULL)
  )
);

CREATE TABLE artist_ranking_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES boost_campaigns(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  rank_no integer NOT NULL CHECK (rank_no > 0),
  total_free_likes numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_free_likes >= 0),
  total_lumina_boosts numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_lumina_boosts >= 0),
  total_weighted_score numeric(18,4) NOT NULL DEFAULT 0 CHECK (total_weighted_score >= 0),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, snapshot_at, rank_no),
  UNIQUE (campaign_id, snapshot_at, artist_id)
);

CREATE TABLE artist_main_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES boost_campaigns(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  source_snapshot_id uuid REFERENCES artist_ranking_snapshots(id),
  pick_reason text NOT NULL CHECK (pick_reason IN ('ranking_winner', 'editorial', 'event_reward')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE artist_unlock_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boost_campaign_id uuid REFERENCES boost_campaigns(id),
  artist_id uuid REFERENCES artists(id),
  name text NOT NULL,
  unlock_kind text NOT NULL CHECK (unlock_kind IN ('company_reward', 'ranking_reward', 'milestone_reward')),
  unlock_condition jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'unlocked', 'cancelled', 'archived')),
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_unlock_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unlock_campaign_id uuid NOT NULL REFERENCES artist_unlock_campaigns(id),
  asset_id uuid REFERENCES assets(id),
  reward_type text NOT NULL CHECK (reward_type IN ('image', 'shortform', 'outfit', 'item', 'premium_preview', 'message')),
  title text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE premium_video_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid REFERENCES artists(id),
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  price_lumina numeric(18,2) NOT NULL CHECK (price_lumina > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE premium_video_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  premium_video_product_id uuid NOT NULL REFERENCES premium_video_products(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  role text NOT NULL CHECK (role IN ('video', 'thumbnail', 'preview')),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (premium_video_product_id, asset_id, role)
);

CREATE TABLE user_premium_video_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  premium_video_product_id uuid NOT NULL REFERENCES premium_video_products(id),
  wallet_ledger_id uuid REFERENCES wallet_ledger(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (user_id, premium_video_product_id)
);

CREATE TABLE chat_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  system_prompt text NOT NULL,
  safety_rules jsonb NOT NULL DEFAULT '{}',
  model_config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  chat_persona_id uuid REFERENCES chat_personas(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_feature_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  feature_type text NOT NULL CHECK (feature_type IN ('special_reply', 'voice_reply', 'image_reply', 'special_line')),
  price_lumina numeric(18,2) NOT NULL CHECK (price_lumina > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_feature_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  chat_session_id uuid NOT NULL REFERENCES chat_sessions(id),
  chat_feature_product_id uuid NOT NULL REFERENCES chat_feature_products(id),
  wallet_ledger_id uuid REFERENCES wallet_ledger(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id uuid NOT NULL REFERENCES chat_sessions(id),
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'artist', 'system')),
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'audio', 'video', 'system')),
  body text,
  asset_id uuid REFERENCES assets(id),
  chat_feature_order_id uuid REFERENCES chat_feature_orders(id),
  model_metadata jsonb NOT NULL DEFAULT '{}',
  safety_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  entitlement_type text NOT NULL CHECK (entitlement_type IN ('premium_video', 'chat_feature', 'boost_reward', 'event_reward', 'membership')),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  granted_by_reference_type text,
  granted_by_reference_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entitlement_type, reference_type, reference_id)
);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  role_id uuid NOT NULL REFERENCES admin_roles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_by_user_id uuid REFERENCES users(id),
  last_access_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_artists_status_sort ON artists(status, sort_order);
CREATE INDEX idx_assets_type_visibility ON assets(asset_type, visibility);
CREATE INDEX idx_artist_assets_artist_usage ON artist_assets(artist_id, usage_type);
CREATE INDEX idx_shortforms_artist_status ON shortforms(artist_id, status, published_at);
CREATE INDEX idx_wallet_ledger_account_created ON wallet_ledger(wallet_account_id, created_at);
CREATE INDEX idx_wallet_ledger_reference ON wallet_ledger(reference_type, reference_id);
CREATE INDEX idx_wallet_holds_account_status ON wallet_holds(wallet_account_id, status);
CREATE INDEX idx_payment_orders_user_status ON payment_orders(user_id, status);
CREATE INDEX idx_payment_orders_provider_status ON payment_orders(provider, status);
CREATE INDEX idx_gift_orders_user_created ON gift_orders(user_id, created_at);
CREATE INDEX idx_gift_orders_artist_created ON gift_orders(artist_id, created_at);
CREATE INDEX idx_reaction_events_artist_created ON artist_reaction_events(artist_id, created_at);
CREATE INDEX idx_boost_campaigns_status_dates ON boost_campaigns(status, starts_at, ends_at);
CREATE INDEX idx_boost_events_campaign_artist ON artist_boost_events(campaign_id, artist_id, created_at);
CREATE INDEX idx_boost_events_user_created ON artist_boost_events(user_id, created_at);
CREATE INDEX idx_ranking_snapshots_campaign_rank ON artist_ranking_snapshots(campaign_id, snapshot_at, rank_no);
CREATE INDEX idx_main_picks_artist_dates ON artist_main_picks(artist_id, starts_at, ends_at);
CREATE INDEX idx_unlock_campaigns_artist_status ON artist_unlock_campaigns(artist_id, status);
CREATE INDEX idx_premium_unlocks_user ON user_premium_video_unlocks(user_id, unlocked_at);
CREATE INDEX idx_chat_sessions_user_artist ON chat_sessions(user_id, artist_id, updated_at);
CREATE INDEX idx_chat_messages_session_created ON chat_messages(chat_session_id, created_at);
CREATE INDEX idx_chat_feature_orders_user_created ON chat_feature_orders(user_id, created_at);
CREATE INDEX idx_entitlements_user_active ON user_entitlements(user_id, entitlement_type, expires_at, revoked_at);
CREATE INDEX idx_admin_users_status ON admin_users(status);
CREATE INDEX idx_admin_users_role ON admin_users(role_id);
CREATE INDEX idx_audit_events_target ON audit_events(target_type, target_id, created_at);
