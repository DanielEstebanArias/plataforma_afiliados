CREATE TABLE "AffiliatePasswordReset" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "networkId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "tokenDigest" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE,
  FOREIGN KEY("tenantId","networkId","memberId") REFERENCES "AffiliateMember"("tenantId","networkId",id) ON DELETE CASCADE
);
CREATE INDEX "AffiliatePasswordReset_tenantId_networkId_memberId_expiresAt_idx"
  ON "AffiliatePasswordReset"("tenantId","networkId","memberId","expiresAt");
ALTER TABLE "AffiliatePasswordReset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliatePasswordReset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AffiliatePasswordReset"
  USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON "AffiliatePasswordReset" TO superapp_runtime;
