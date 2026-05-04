ALTER TABLE "chat_feature_products" DROP CONSTRAINT IF EXISTS "chat_feature_products_status_check";

ALTER TABLE "chat_feature_products"
  ADD CONSTRAINT "chat_feature_products_status_check"
  CHECK ("status" IN ('draft', 'active', 'inactive', 'archived'));
