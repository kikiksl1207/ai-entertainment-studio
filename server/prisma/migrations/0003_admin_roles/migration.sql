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

CREATE INDEX idx_admin_users_status ON admin_users(status);
CREATE INDEX idx_admin_users_role ON admin_users(role_id);

INSERT INTO admin_roles (name, description, permissions)
VALUES
  ('super_admin', 'Full access to all admin operations', ARRAY['*']),
  ('content_admin', 'Manage artists, assets, shortforms, and content operations', ARRAY['assets:write', 'artists:write', 'shortforms:write', 'audit:read']),
  ('commerce_admin', 'Manage Lumina products, gifts, boosts, premium videos, and payment operations', ARRAY['commerce:write', 'payments:read', 'audit:read'])
ON CONFLICT (name) DO NOTHING;
