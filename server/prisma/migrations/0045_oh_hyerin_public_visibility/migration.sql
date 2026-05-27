-- Backfill Oh Hyerin so live read projections include her without requiring a manual seed rerun.
WITH artist_row AS (
  INSERT INTO artists (
    slug,
    display_name,
    status,
    sort_order,
    launched_at,
    updated_at
  )
  VALUES (
    'oh-hyerin',
    '오혜린',
    'active',
    50,
    '2026-04-27T00:00:00.000Z',
    NOW()
  )
  ON CONFLICT (slug) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    status = 'active',
    sort_order = EXCLUDED.sort_order,
    launched_at = COALESCE(artists.launched_at, EXCLUDED.launched_at),
    updated_at = NOW()
  RETURNING id
),
cover_asset AS (
  INSERT INTO assets (
    asset_type,
    visibility,
    storage_provider,
    storage_key,
    mime_type,
    metadata,
    updated_at
  )
  VALUES (
    'image',
    'public',
    'local',
    'assets/characters/oh-hyerin/site-selected/cover.png',
    'image/png',
    '{"title":"오혜린 cover","seed":true}'::jsonb,
    NOW()
  )
  ON CONFLICT (storage_provider, storage_key) DO UPDATE
  SET
    asset_type = 'image',
    visibility = 'public',
    mime_type = 'image/png',
    metadata = '{"title":"오혜린 cover","seed":true}'::jsonb,
    updated_at = NOW()
  RETURNING id
),
thumb_asset AS (
  INSERT INTO assets (
    asset_type,
    visibility,
    storage_provider,
    storage_key,
    mime_type,
    metadata,
    updated_at
  )
  VALUES (
    'image',
    'public',
    'local',
    'assets/characters/oh-hyerin/site-selected/thumb.png',
    'image/png',
    '{"title":"오혜린 thumb","seed":true}'::jsonb,
    NOW()
  )
  ON CONFLICT (storage_provider, storage_key) DO UPDATE
  SET
    asset_type = 'image',
    visibility = 'public',
    mime_type = 'image/png',
    metadata = '{"title":"오혜린 thumb","seed":true}'::jsonb,
    updated_at = NOW()
  RETURNING id
),
demote_old_primary_assets AS (
  UPDATE artist_assets
  SET is_primary = false
  WHERE artist_id = (SELECT id FROM artist_row)
    AND usage_type IN ('cover', 'thumb')
    AND asset_id NOT IN (
      (SELECT id FROM cover_asset),
      (SELECT id FROM thumb_asset)
    )
  RETURNING id
),
cover_link AS (
  INSERT INTO artist_assets (
    artist_id,
    asset_id,
    usage_type,
    is_primary,
    sort_order
  )
  SELECT
    artist_row.id,
    cover_asset.id,
    'cover',
    true,
    10
  FROM artist_row, cover_asset
  ON CONFLICT (artist_id, asset_id, usage_type) DO UPDATE
  SET
    is_primary = true,
    sort_order = 10
  RETURNING id
)
INSERT INTO artist_assets (
  artist_id,
  asset_id,
  usage_type,
  is_primary,
  sort_order
)
SELECT
  artist_row.id,
  thumb_asset.id,
  'thumb',
  true,
  20
FROM artist_row, thumb_asset
ON CONFLICT (artist_id, asset_id, usage_type) DO UPDATE
SET
  is_primary = true,
  sort_order = 20;
