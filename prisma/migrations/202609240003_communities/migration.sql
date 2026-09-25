ALTER TABLE "AffiliateNetwork"
 ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
 ADD COLUMN "platformRoot" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "requestedBy" UUID,
 ADD COLUMN "reviewNote" TEXT,
 ADD COLUMN "reviewedAt" TIMESTAMP(3),
 ADD COLUMN "reviewedBy" UUID,
 ADD COLUMN "maxLoginLevel" INTEGER,
 ADD COLUMN "photo" BYTEA,
 ADD COLUMN "photoMime" TEXT;
-- Existing communities retain their access. Only the oldest network in each tenant approves requests.
UPDATE "AffiliateNetwork" SET "approvalStatus"='APPROVED';
UPDATE "AffiliateNetwork" n SET "platformRoot"=true FROM (
 SELECT DISTINCT ON(a."tenantId") a."tenantId",n.id FROM "AffiliateNetwork" n JOIN "App" a ON a.id=n."appId" ORDER BY a."tenantId",a."createdAt",n.id
) first WHERE n.id=first.id;
ALTER TABLE "AffiliateNetwork" ADD CONSTRAINT affiliate_level_valid CHECK("maxLoginLevel" IS NULL OR "maxLoginLevel">=0);
ALTER TABLE "AffiliateNetwork" ADD CONSTRAINT affiliate_approval_valid CHECK("approvalStatus" IN ('PENDING','APPROVED','REJECTED','SUSPENDED'));
ALTER TABLE "AffiliateMember" ADD COLUMN dashboard JSONB NOT NULL DEFAULT '[]';
CREATE INDEX affiliate_member_page ON "AffiliateMember"("tenantId","networkId",id);
CREATE INDEX affiliate_community_requests ON "AffiliateNetwork"("tenantId","requestedBy","approvalStatus");
