CREATE TABLE "AffiliateTermsVersion" (
  id UUID PRIMARY KEY, "tenantId" UUID NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0), title TEXT NOT NULL, content TEXT NOT NULL,
  "publishedBy" UUID NOT NULL, "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", version), UNIQUE ("tenantId", id)
);
CREATE TABLE "AffiliateTermsAcceptance" (
  "tenantId" UUID NOT NULL, "networkId" UUID NOT NULL, "memberId" UUID NOT NULL,
  "versionId" UUID NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "memberId", "versionId"),
  FOREIGN KEY ("tenantId", "networkId", "memberId")
    REFERENCES "AffiliateMember"("tenantId", "networkId", id) ON DELETE CASCADE,
  FOREIGN KEY ("tenantId", "versionId")
    REFERENCES "AffiliateTermsVersion"("tenantId", id) ON DELETE CASCADE
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['AffiliateTermsVersion','AffiliateTermsAcceptance'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO superapp_runtime',t);
  END LOOP;
END $$;
