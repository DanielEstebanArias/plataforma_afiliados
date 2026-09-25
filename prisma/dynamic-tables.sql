-- Narrow DDL capability: only server-validated metadata becomes identifiers/types.
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
