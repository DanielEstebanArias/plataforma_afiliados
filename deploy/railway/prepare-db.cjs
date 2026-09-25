// Explicit administrator operation, never called by the application startup.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
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
 for(const [table,column,migration] of [['AffiliateNetwork','approvalStatus','202609240003_communities'],['AffiliateMember','ancestry','202609240004_tree_index']]){
  if(!sql(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}';`))sql('BEGIN;\n'+fs.readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8')+'\nCOMMIT;');
 }
 sql(`GRANT USAGE ON SCHEMA public TO superapp_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO superapp_runtime;
 REVOKE UPDATE,DELETE ON "AuditLog" FROM superapp_runtime;
 DO $$ DECLARE n text; BEGIN
 FOR n IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^tenant_[0-9a-f]{32}$' LOOP
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO superapp_runtime',n);
 EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO superapp_runtime',n);
 END LOOP; END $$;`);
 console.log('Esquema de Afiliados preparado. Usa superapp_runtime en DATABASE_URL con su contraseña vigente.');
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exit(1);}}
module.exports={main};
