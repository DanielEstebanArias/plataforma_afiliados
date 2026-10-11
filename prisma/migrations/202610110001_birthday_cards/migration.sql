ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "birthdayCard" BYTEA,
  ADD COLUMN IF NOT EXISTS "birthdayCardMime" TEXT,
  ADD COLUMN IF NOT EXISTS "birthdayNameX" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "birthdayNameY" DOUBLE PRECISION NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "birthdayFontSize" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "birthdayTextColor" TEXT NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN IF NOT EXISTS "birthdayEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AffiliateBirthdayDelivery" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "memberId" UUID NOT NULL,
  "birthdayYear" INTEGER NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "providerId" TEXT,
  error TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  UNIQUE("tenantId", "memberId", "birthdayYear")
);
CREATE INDEX IF NOT EXISTS "AffiliateBirthdayDelivery_tenantId_status_createdAt_idx"
  ON "AffiliateBirthdayDelivery"("tenantId", status, "createdAt");
ALTER TABLE "AffiliateBirthdayDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateBirthdayDelivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AffiliateBirthdayDelivery";
CREATE POLICY tenant_isolation ON "AffiliateBirthdayDelivery"
  USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON "AffiliateBirthdayDelivery" TO superapp_runtime;
