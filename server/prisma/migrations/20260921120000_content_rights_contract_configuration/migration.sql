CREATE TABLE "content_rights_contracts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_type" TEXT NOT NULL CHECK ("work_type" IN ('story', 'ott')),
  "work_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("work_type", "work_id")
);
CREATE INDEX "idx_content_rights_contracts_created" ON "content_rights_contracts"("created_at");

CREATE TABLE "content_rights_contract_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL REFERENCES "content_rights_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "source_version_id" UUID,
  "content_version_id" UUID NOT NULL,
  "exclusivity" TEXT NOT NULL CHECK ("exclusivity" IN ('exclusive', 'nonexclusive')),
  "media" JSONB NOT NULL,
  "regions" JSONB NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6),
  "sale_allowed" BOOLEAN NOT NULL,
  "ai_transformation_allowed" BOOLEAN NOT NULL,
  "generated_result_reuse_allowed" BOOLEAN NOT NULL,
  "approval_state" TEXT NOT NULL CHECK ("approval_state" IN ('draft', 'approved_configuration')),
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "author_rights_holder_share_bps" INTEGER NOT NULL CHECK ("author_rights_holder_share_bps" BETWEEN 0 AND 5000),
  "sales_agency_share_bps" INTEGER NOT NULL CHECK ("sales_agency_share_bps" BETWEEN 0 AND 1000),
  "company_share_bps" INTEGER NOT NULL CHECK ("company_share_bps" >= 4500),
  "point_usage_policy" TEXT NOT NULL CHECK ("point_usage_policy" = 'unresolved'),
  "refund_reversal_policy" TEXT NOT NULL CHECK ("refund_reversal_policy" = 'unresolved'),
  "paid_point_policy" TEXT NOT NULL CHECK ("paid_point_policy" = 'unresolved'),
  "bonus_point_policy" TEXT NOT NULL CHECK ("bonus_point_policy" = 'unresolved'),
  "vat_policy" TEXT NOT NULL CHECK ("vat_policy" = 'unresolved'),
  "internal_generation_cost_treatment" TEXT NOT NULL CHECK ("internal_generation_cost_treatment" = 'company_internal_cost_not_deducted_from_creator_share'),
  "created_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "approved_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("contract_id", "revision"),
  CONSTRAINT "uq_content_rights_versions_contract_id" UNIQUE ("contract_id", "id"),
  CONSTRAINT "content_rights_versions_source_same_contract_fkey"
    FOREIGN KEY ("contract_id", "source_version_id")
    REFERENCES "content_rights_contract_versions"("contract_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CHECK ("author_rights_holder_share_bps" + "sales_agency_share_bps" <= 5500),
  CHECK ("company_share_bps" = 10000 - "author_rights_holder_share_bps" - "sales_agency_share_bps"),
  CHECK (("approval_state" = 'approved_configuration') = ("approved_by_user_id" IS NOT NULL))
);
CREATE INDEX "idx_content_rights_versions_effective" ON "content_rights_contract_versions"("contract_id", "effective_from", "revision");

CREATE TABLE "content_rights_contract_parties" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_version_id" UUID NOT NULL REFERENCES "content_rights_contract_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('author', 'rights_holder', 'sales_agency')),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "agency_identifier" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("contract_version_id", "role", "user_id"),
  CHECK (("role" = 'sales_agency') = ("agency_identifier" IS NOT NULL))
);
CREATE INDEX "idx_content_rights_parties_user" ON "content_rights_contract_parties"("user_id", "contract_version_id");

CREATE TABLE "content_rights_contract_audits" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL REFERENCES "content_rights_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contract_version_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL CHECK ("action" IN ('created', 'revised', 'approved_configuration')),
  "snapshot_hash" TEXT NOT NULL CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_rights_audits_version_same_contract_fkey"
    FOREIGN KEY ("contract_id", "contract_version_id")
    REFERENCES "content_rights_contract_versions"("contract_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_content_rights_audits_contract" ON "content_rights_contract_audits"("contract_id", "created_at", "id");

CREATE FUNCTION reject_content_rights_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content rights contract history is append-only';
END;
$$;
CREATE TRIGGER content_rights_contracts_immutable BEFORE UPDATE OR DELETE ON "content_rights_contracts"
  FOR EACH ROW EXECUTE FUNCTION reject_content_rights_history_mutation();
CREATE TRIGGER content_rights_versions_immutable BEFORE UPDATE OR DELETE ON "content_rights_contract_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_content_rights_history_mutation();
CREATE TRIGGER content_rights_parties_immutable BEFORE UPDATE OR DELETE ON "content_rights_contract_parties"
  FOR EACH ROW EXECUTE FUNCTION reject_content_rights_history_mutation();
CREATE TRIGGER content_rights_audits_immutable BEFORE UPDATE OR DELETE ON "content_rights_contract_audits"
  FOR EACH ROW EXECUTE FUNCTION reject_content_rights_history_mutation();
