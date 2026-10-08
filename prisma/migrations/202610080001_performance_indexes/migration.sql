-- Keep interactive filtering and session cleanup predictable as each community grows.
CREATE INDEX "AffiliateMember_tenantId_networkId_status_createdAt_idx"
  ON "AffiliateMember"("tenantId", "networkId", status, "createdAt");
CREATE INDEX "AffiliateSession_tenantId_networkId_expires_idx"
  ON "AffiliateSession"("tenantId", "networkId", expires);

-- The directory uses contains-searches. B-tree indexes cannot serve ILIKE '%term%'.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX affiliate_member_name_search
  ON "AffiliateMember" USING gin (name gin_trgm_ops);
CREATE INDEX affiliate_member_email_search
  ON "AffiliateMember" USING gin (email gin_trgm_ops);
CREATE INDEX affiliate_member_data_search
  ON "AffiliateMember" USING gin ((data::text) gin_trgm_ops);
