-- Afiliados-only core profile. No vector/PostGIS services are installed.
-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'TRIAL',
    "quotas" JSONB NOT NULL DEFAULT '{"apps":10,"aiTokens":1000000,"records":100000}',
    "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Membership" (
    "tenantId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("tenantId","subject")
);
-- CreateTable
CREATE TABLE "App" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "theme" JSONB NOT NULL DEFAULT '{"primary":"#2563EB","background":"#FFFFFF","fontFamily":"Roboto","radius":12}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Screen" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tree" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screen_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "DynamicSchema" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DynamicSchema_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "DynamicRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "schemaId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DynamicRecord_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "aiTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");
-- CreateIndex
CREATE UNIQUE INDEX "App_bundleId_key" ON "App"("bundleId");
-- CreateIndex
CREATE UNIQUE INDEX "App_tenantId_id_key" ON "App"("tenantId", "id");
-- CreateIndex
CREATE UNIQUE INDEX "Screen_tenantId_appId_route_key" ON "Screen"("tenantId", "appId", "route");
-- CreateIndex
CREATE UNIQUE INDEX "Screen_tenantId_id_key" ON "Screen"("tenantId", "id");
-- CreateIndex
CREATE UNIQUE INDEX "DynamicSchema_tenantId_appId_name_key" ON "DynamicSchema"("tenantId", "appId", "name");
-- CreateIndex
CREATE UNIQUE INDEX "DynamicSchema_tenantId_id_key" ON "DynamicSchema"("tenantId", "id");
-- CreateIndex
CREATE INDEX "DynamicRecord_tenantId_schemaId_createdAt_idx" ON "DynamicRecord"("tenantId", "schemaId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "DynamicRecord_tenantId_schemaId_idempotencyKey_key" ON "DynamicRecord"("tenantId", "schemaId", "idempotencyKey");
-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_tenantId_appId_fkey" FOREIGN KEY ("tenantId", "appId") REFERENCES "App"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DynamicSchema" ADD CONSTRAINT "DynamicSchema_tenantId_appId_fkey" FOREIGN KEY ("tenantId", "appId") REFERENCES "App"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DynamicRecord" ADD CONSTRAINT "DynamicRecord_tenantId_schemaId_fkey" FOREIGN KEY ("tenantId", "schemaId") REFERENCES "DynamicSchema"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS dynamic_record_data_idx ON "DynamicRecord" USING gin (data jsonb_path_ops);
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "Tenant" USING ("id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("id"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "Membership" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "App" ENABLE ROW LEVEL SECURITY; ALTER TABLE "App" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "App" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "Screen" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Screen" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "Screen" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "DynamicSchema" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DynamicSchema" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "DynamicSchema" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "DynamicRecord" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DynamicRecord" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "DynamicRecord" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "AuditLog" USING ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId"=nullif(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO superapp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO superapp_runtime; REVOKE UPDATE,DELETE ON "AuditLog" FROM superapp_runtime;
CREATE OR REPLACE FUNCTION public.provision_dynamic_table() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE namespace text; table_name text; field jsonb; columns text=''; sql_type text;
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'Tenant context mismatch';
  END IF;
  namespace := 'tenant_'||replace(NEW."tenantId"::text,'-','');
  table_name := 'table_'||replace(NEW.id::text,'-','');
  IF jsonb_typeof(NEW.fields)<>'array' OR jsonb_array_length(NEW.fields)>100 THEN
    RAISE EXCEPTION 'Invalid fields';
  END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(NEW.fields) LOOP
    IF field->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN RAISE EXCEPTION 'Invalid field'; END IF;
    sql_type := CASE field->>'type' WHEN 'text' THEN 'text' WHEN 'email' THEN 'text'
      WHEN 'number' THEN 'double precision' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'timestamptz'
      WHEN 'file' THEN 'jsonb' WHEN 'signature' THEN 'jsonb' WHEN 'location' THEN 'jsonb' WHEN 'json' THEN 'jsonb' ELSE NULL END;
    IF sql_type IS NULL THEN RAISE EXCEPTION 'Unsupported field type'; END IF;
    columns := columns||format(', %I %s %s',field->>'name',sql_type,
      CASE WHEN (field->>'required')::boolean THEN 'NOT NULL' ELSE '' END);
  END LOOP;
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I',namespace);
  EXECUTE format('CREATE TABLE %I.%I (__id uuid PRIMARY KEY REFERENCES public."DynamicRecord"(id) ON DELETE CASCADE, __tenant_id uuid NOT NULL REFERENCES public."Tenant"(id) ON DELETE CASCADE%s)',namespace,table_name,columns);
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',namespace,table_name);
  EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',namespace,table_name);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (__tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (__tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',namespace,table_name);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO superapp_runtime',namespace);
  EXECUTE format('GRANT SELECT ON %I.%I TO superapp_runtime',namespace,table_name);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.provision_dynamic_table() FROM PUBLIC;
CREATE TRIGGER provision_dynamic_table AFTER INSERT ON public."DynamicSchema"
FOR EACH ROW EXECUTE FUNCTION public.provision_dynamic_table();

CREATE OR REPLACE FUNCTION public.mirror_dynamic_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE namespace text; table_name text; data jsonb;
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'Tenant context mismatch';
  END IF;
  namespace := 'tenant_'||replace(NEW."tenantId"::text,'-','');
  table_name := 'table_'||replace(NEW."schemaId"::text,'-','');
  data := NEW.data||jsonb_build_object('__id',NEW.id,'__tenant_id',NEW."tenantId");
  IF TG_OP='UPDATE' THEN
    IF NEW."schemaId"<>OLD."schemaId" OR NEW."tenantId"<>OLD."tenantId" OR NEW.id<>OLD.id THEN
      RAISE EXCEPTION 'Record identity cannot change';
    END IF;
    EXECUTE format('DELETE FROM %I.%I WHERE __id=$1',namespace,table_name) USING NEW.id;
  END IF;
  EXECUTE format('INSERT INTO %I.%I SELECT * FROM jsonb_populate_record(NULL::%I.%I,$1)',namespace,table_name,namespace,table_name) USING data;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mirror_dynamic_record() FROM PUBLIC;
CREATE TRIGGER mirror_dynamic_record AFTER INSERT OR UPDATE ON public."DynamicRecord"
FOR EACH ROW EXECUTE FUNCTION public.mirror_dynamic_record();

CREATE OR REPLACE FUNCTION public.guard_dynamic_schema_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.fields IS DISTINCT FROM OLD.fields OR NEW."tenantId"<>OLD."tenantId" OR NEW.id<>OLD.id THEN
    RAISE EXCEPTION 'Create a versioned replacement schema to change fields';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_dynamic_schema_update BEFORE UPDATE ON public."DynamicSchema"
FOR EACH ROW EXECUTE FUNCTION public.guard_dynamic_schema_update();
