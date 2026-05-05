DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'wallet_ledger'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%ledger_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE wallet_ledger DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_ledger_type_check
  CHECK (
    ledger_type IN (
      'purchase',
      'gift_spend',
      'boost_spend',
      'chat_feature_spend',
      'premium_video_spend',
      'refund',
      'adjustment',
      'event_grant',
      'hold_capture',
      'hold_release',
      'daily_attendance',
      'user_gift_send',
      'user_gift_receive',
      'fan_letter_spend',
      'settlement_lumina_conversion'
    )
  );
