INSERT INTO admin_roles (name, description, permissions)
VALUES
  (
    'accounting_admin',
    'Manage settlement review, payment reads, refunds, and accounting operations',
    ARRAY['payments:read', 'settlements:write', 'refunds:write', 'audit:read']
  ),
  (
    'sales_admin',
    'Review debut/creator applications and partnership/contact operations',
    ARRAY['creators:read', 'users:read', 'audit:read']
  ),
  (
    'cs_admin',
    'Handle user support, community reports, and basic audit lookups',
    ARRAY['users:read', 'community:write', 'audit:read']
  ),
  (
    'ai_artist_admin',
    'Manage AI artists, assets, shortforms, creator access, and content operations',
    ARRAY['artists:write', 'assets:write', 'shortforms:write', 'creators:write', 'audit:read']
  )
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  updated_at = now();

UPDATE admin_roles
SET
  permissions = ARRAY['assets:write', 'artists:write', 'shortforms:write', 'creators:read', 'audit:read'],
  updated_at = now()
WHERE name = 'content_admin';

UPDATE admin_roles
SET
  permissions = ARRAY['commerce:write', 'payments:read', 'settlements:write', 'audit:read'],
  updated_at = now()
WHERE name = 'commerce_admin';
