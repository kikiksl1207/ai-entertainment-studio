UPDATE admin_roles
SET
  permissions = ARRAY[
    'products:write',
    'boosts:write',
    'premium_videos:write',
    'chat_products:write',
    'refunds:write',
    'payments:read',
    'audit:read'
  ],
  updated_at = now()
WHERE name = 'commerce_admin';
