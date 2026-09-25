-- Run as migration owner, never as the application role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Tenant','Membership','ApiKey','App','AIAgentWorkspace',
    'AIMessage','KnowledgeChunk','Screen','DynamicSchema','DynamicRecord','Workflow',
    'WorkflowEvent','WorkflowStep','GatewayConfig','PaymentTransaction','PaymentOffer','AuditLog','Build','GeoPosition','Asset']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (%I = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (%I = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',
      t, CASE WHEN t='Tenant' THEN 'id' ELSE 'tenantId' END,
      CASE WHEN t='Tenant' THEN 'id' ELSE 'tenantId' END);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO superapp_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO superapp_runtime;
REVOKE UPDATE, DELETE ON "AuditLog" FROM superapp_runtime;
REVOKE INSERT, UPDATE, DELETE ON spatial_ref_sys FROM superapp_runtime;
REVOKE ALL ON "_prisma_migrations" FROM superapp_runtime;
CREATE INDEX IF NOT EXISTS knowledge_embedding_idx ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS geo_point_idx ON "GeoPosition" USING gist (point);
CREATE INDEX IF NOT EXISTS dynamic_record_data_idx ON "DynamicRecord" USING gin (data jsonb_path_ops);
