CREATE TABLE "AffiliateCampaign" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "networkId" UUID NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "fieldIds" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId","networkId","id"),
  FOREIGN KEY("tenantId","networkId") REFERENCES "AffiliateNetwork"("tenantId","id") ON DELETE CASCADE
);
CREATE INDEX "AffiliateCampaign_tenantId_networkId_createdAt_idx" ON "AffiliateCampaign"("tenantId","networkId","createdAt");

CREATE TABLE "AffiliateCampaignEntry" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "networkId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId","networkId","id"),
  FOREIGN KEY("tenantId","networkId","campaignId") REFERENCES "AffiliateCampaign"("tenantId","networkId","id") ON DELETE CASCADE
);
CREATE INDEX "AffiliateCampaignEntry_tenantId_networkId_campaignId_createdAt_idx" ON "AffiliateCampaignEntry"("tenantId","networkId","campaignId","createdAt");

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['AffiliateCampaign','AffiliateCampaignEntry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)', t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO superapp_runtime', t);
  END LOOP;
END $$;
