BEGIN;

-- Extend, rather than replace, the existing accepted type expressions. This
-- preserves all legacy wallet/reward types (and any prior additive migrations).
DO $$
DECLARE
  item record;
  previous_expression text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('wallet_ledger', 'wallet_ledger_ledger_type_check', 'ledger_type', 'story_purchase'),
    ('user_entitlements', 'user_entitlements_entitlement_type_check', 'entitlement_type', 'story_work')
  ) AS additions(table_name, constraint_name, column_name, new_type)
  LOOP
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT previous_expression
    FROM pg_constraint
    WHERE conrelid = item.table_name::regclass AND conname = item.constraint_name AND contype = 'c';
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, item.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I = %L)',
      item.table_name, item.constraint_name, previous_expression, item.column_name, item.new_type);
  END LOOP;
END $$;

COMMIT;
