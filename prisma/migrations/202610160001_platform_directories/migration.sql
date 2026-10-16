CREATE TABLE "PlatformAdministrator" (
  "id" UUID PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "password" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PlatformAdminSession" (
  "tokenDigest" TEXT PRIMARY KEY,
  "administratorId" UUID NOT NULL REFERENCES "PlatformAdministrator"("id") ON DELETE CASCADE,
  "csrf" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PlatformAdminSession_administratorId_expiresAt_idx"
  ON "PlatformAdminSession"("administratorId","expiresAt");
CREATE TABLE "PlatformAuditLog" (
  "id" UUID PRIMARY KEY,
  "administratorId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "directoryId" UUID,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformAuditLog_administratorId_createdAt_idx"
  ON "PlatformAuditLog"("administratorId","createdAt");
CREATE TABLE "PlatformDirectory" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "rootAppId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slogan" TEXT NOT NULL,
  "divisionLabel" TEXT NOT NULL DEFAULT 'Subregiones',
  "directoryAdminName" TEXT NOT NULL,
  "directoryAdminEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy" UUID NOT NULL REFERENCES "PlatformAdministrator"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3)
);
CREATE INDEX "PlatformDirectory_status_createdAt_idx" ON "PlatformDirectory"("status","createdAt");
ALTER TABLE "AffiliateSession" ADD COLUMN "platformAdminId" UUID;
GRANT SELECT,INSERT,UPDATE,DELETE ON "PlatformAdministrator","PlatformAdminSession","PlatformDirectory","PlatformAuditLog" TO superapp_runtime;
REVOKE UPDATE,DELETE ON "PlatformAuditLog" FROM superapp_runtime;
