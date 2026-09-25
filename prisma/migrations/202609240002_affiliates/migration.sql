CREATE TABLE "AffiliateNetwork" (
 "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "appId" UUID NOT NULL UNIQUE,
 "name" TEXT NOT NULL, "fields" JSONB NOT NULL, "schemaId" UUID NOT NULL REFERENCES "DynamicSchema"(id), "formVersion" INTEGER NOT NULL DEFAULT 1,
 UNIQUE("tenantId","id"), UNIQUE("tenantId","appId"),
 FOREIGN KEY("tenantId","appId") REFERENCES "App"("tenantId",id) ON DELETE CASCADE
);
CREATE TABLE "AffiliateMember" (
 "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "networkId" UUID NOT NULL, "parentId" UUID,
 "name" TEXT NOT NULL, "email" TEXT NOT NULL, "password" TEXT NOT NULL, "role" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'active', "data" JSONB NOT NULL, "photo" BYTEA, "mime" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","networkId",id), UNIQUE("tenantId","networkId",email),
 FOREIGN KEY("tenantId","networkId") REFERENCES "AffiliateNetwork"("tenantId",id) ON DELETE CASCADE,
 FOREIGN KEY("tenantId","networkId","parentId") REFERENCES "AffiliateMember"("tenantId","networkId",id)
);
CREATE INDEX ON "AffiliateMember"("tenantId","networkId","parentId");
CREATE TABLE "AffiliateSession" (
 token TEXT PRIMARY KEY, "tenantId" UUID NOT NULL, "networkId" UUID NOT NULL,
 "memberId" UUID NOT NULL, csrf TEXT NOT NULL, expires BIGINT NOT NULL,
 FOREIGN KEY("tenantId","networkId","memberId") REFERENCES "AffiliateMember"("tenantId","networkId",id) ON DELETE CASCADE
);
CREATE INDEX ON "AffiliateSession"("tenantId","networkId","memberId");
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['AffiliateNetwork','AffiliateMember','AffiliateSession'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK ("tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)', t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO superapp_runtime', t);
 END LOOP;
END $$;
