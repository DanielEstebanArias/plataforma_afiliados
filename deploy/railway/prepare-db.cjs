// Explicit administrator operation, never called by the application startup.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {randomBytes,scryptSync}=require('node:crypto');
function sql(input){
 const url=new URL(process.env.DATABASE_OWNER_URL);
 url.searchParams.delete('schema');
 const r=spawnSync(process.env.PSQL_BIN||'psql',['-X','-w','-q','-v','ON_ERROR_STOP=1','-tA','-d',url.href],{input,encoding:'utf8',env:{...process.env,PGCONNECT_TIMEOUT:'15'},windowsHide:true,timeout:60000});
 if(r.status!==0)throw new Error('Falló PostgreSQL. Revisa acceso del propietario y psql. No se imprimen credenciales.');
 return r.stdout.trim();
}
function main(){
 if(!process.env.DATABASE_OWNER_URL||!process.env.RUNTIME_DB_PASSWORD||process.env.RUNTIME_DB_PASSWORD.length<24)throw new Error('Configura DATABASE_OWNER_URL y RUNTIME_DB_PASSWORD (mínimo 24 caracteres).');
 const password=process.env.RUNTIME_DB_PASSWORD.replaceAll("'","''");
 const existing=sql("SELECT 1 FROM pg_roles WHERE rolname='superapp_runtime';");
 if(!existing)sql(`CREATE ROLE superapp_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}';`);
 sql('ALTER ROLE superapp_runtime NOSUPERUSER NOBYPASSRLS;');
 if(process.argv.includes('--roles-only')){console.log('Rol preparado para restauración.');return;}
 const member=sql(`SELECT to_regclass('public."AffiliateMember"');`);
 if(!member){
  if(sql(`SELECT to_regclass('public."Tenant"');`))throw new Error('Base parcial o de otro perfil: no se modificó su esquema. Usa una base vacía o restaura el respaldo completo.');
  sql('BEGIN;\n'+fs.readFileSync(path.join(__dirname,'core.sql'),'utf8')+'\n'+fs.readFileSync('prisma/migrations/202609240002_affiliates/migration.sql','utf8')+'\nCOMMIT;');
 }
 for(const [table,column,migration] of [['AffiliateNetwork','approvalStatus','202609240003_communities'],['AffiliateMember','ancestry','202609240004_tree_index'],['AffiliateNetwork','modules','202609270001_community_modules']]){
  if(!sql(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}';`))sql('BEGIN;\n'+fs.readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8')+'\nCOMMIT;');
 }
 sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202609270002_create_communities_permission/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."AffiliateTermsVersion"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202609290001_affiliate_terms/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Tenant' AND column_name='platformLogo';`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610030001_platform_branding/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."AffiliateMember_tenantId_networkId_status_createdAt_idx"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610080001_performance_indexes/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."AffiliateBirthdayDelivery"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610110001_birthday_cards/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='AffiliateMember' AND column_name='loginOverride';`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610140001_member_login_override/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."AffiliateCampaign"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610150001_campaigns/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."AffiliatePasswordReset"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610150002_password_recovery/migration.sql','utf8')+'\nCOMMIT;');
 if(!sql(`SELECT to_regclass('public."PlatformDirectory"');`))
  sql('BEGIN;\n'+fs.readFileSync('prisma/migrations/202610160001_platform_directories/migration.sql','utf8')+'\nCOMMIT;');
 const tenantId=process.env.AFFILIATES_TENANT_ID,appId=process.env.AFFILIATES_APP_ID;
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId||'')||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(appId||''))
  throw new Error('Configura AFFILIATES_TENANT_ID y AFFILIATES_APP_ID para registrar el Directorio de Antioquia.');
 sql(`BEGIN;
 SELECT set_config('app.tenant_id','${tenantId}',true);
 INSERT INTO "PlatformAdministrator"(id,name,email,password,status)
 SELECT m.id,m.name,lower(m.email),m.password,'ACTIVE'
 FROM "AffiliateMember" m JOIN "AffiliateNetwork" n ON n.id=m."networkId"
 WHERE m."tenantId"='${tenantId}'::uuid AND n."platformRoot"=true AND m.role='ROOT' AND m."parentId" IS NULL
 ON CONFLICT(email) DO UPDATE SET name=excluded.name,password=excluded.password,status='ACTIVE';
 INSERT INTO "PlatformDirectory"(id,"tenantId","rootAppId",name,slogan,"divisionLabel","directoryAdminName","directoryAdminEmail",status,"createdBy")
 SELECT '${tenantId}'::uuid,'${tenantId}'::uuid,'${appId}'::uuid,'Directorio de Antioquia','Por Antioquia ¡Lo que sea!','Subregiones','José Ignacio Cano',lower(m.email),'ACTIVE',a.id
 FROM "AffiliateMember" m JOIN "AffiliateNetwork" n ON n.id=m."networkId"
 JOIN "PlatformAdministrator" a ON a.email=lower(m.email)
 WHERE m."tenantId"='${tenantId}'::uuid AND n."platformRoot"=true AND m.role='ROOT' AND m."parentId" IS NULL
 ON CONFLICT("tenantId") DO NOTHING;
 COMMIT;`);
 const platformPassword=process.env.PLATFORM_ADMIN_PASSWORD;
 if(platformPassword){
  if(platformPassword.length<10||platformPassword.length>200)throw new Error('PLATFORM_ADMIN_PASSWORD debe tener entre 10 y 200 caracteres.');
  const salt=randomBytes(16).toString('hex');
  const passwordHash=(salt+':'+scryptSync(platformPassword,salt,64).toString('hex')).replaceAll("'","''");
  sql(`UPDATE "PlatformAdministrator" SET password='${passwordHash}' WHERE email=(
   SELECT lower(m.email) FROM "AffiliateMember" m JOIN "AffiliateNetwork" n ON n.id=m."networkId"
   WHERE m."tenantId"='${tenantId}'::uuid AND n."platformRoot"=true AND m.role='ROOT' AND m."parentId" IS NULL LIMIT 1
  );`);
 }
 sql(`GRANT USAGE ON SCHEMA public TO superapp_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO superapp_runtime;
 REVOKE UPDATE,DELETE ON "AuditLog" FROM superapp_runtime;
 REVOKE UPDATE,DELETE ON "AffiliateTermsVersion","AffiliateTermsAcceptance" FROM superapp_runtime;
 DO $$ DECLARE n text; BEGIN
 FOR n IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^tenant_[0-9a-f]{32}$' LOOP
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO superapp_runtime',n);
 EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO superapp_runtime',n);
 END LOOP; END $$;`);
 console.log('Esquema de Afiliados preparado. Usa superapp_runtime en DATABASE_URL con su contraseña vigente.');
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exit(1);}}
module.exports={main};
