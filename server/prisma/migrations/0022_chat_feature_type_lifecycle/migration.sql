ALTER TABLE "chat_feature_products" DROP CONSTRAINT IF EXISTS "chat_feature_products_feature_type_check";

ALTER TABLE "chat_feature_products"
  ADD CONSTRAINT "chat_feature_products_feature_type_check"
  CHECK (
    "feature_type" IN (
      'special_reply',
      'voice_reply',
      'image_reply',
      'special_line',
      'deep_reply',
      'story_reply',
      'premium_reply',
      'fan_letter'
    )
  );
