// Creates an isolated local PostgreSQL cluster. Never modifies an existing system database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),data=path.join(root,'affiliates/data'),cluster=path.join(root,'.tooling/pg-affiliates');
const bin=process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/17/bin';
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(path.dirname(cluster),{recursive:true});
const configFile=path.join(data,'superapp-local.json');
let config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{port:54329,ownerPassword:crypto.randomBytes(24).toString('hex'),runtimePassword:crypto.randomBytes(24).toString('hex'),tenantId:crypto.randomUUID(),appId:crypto.randomUUID(),networkId:crypto.randomUUID()};
fs.writeFileSync(configFile,JSON.stringify(config,null,2));
const run=(exe,args,env={})=>{
 const output=path.join(data,'pg-command-'+crypto.randomUUID()+'.log');const fd=fs.openSync(output,'w');
 try{execFileSync(path.join(bin,exe+'.exe'),args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore',fd,fd],timeout:60000});return fs.readFileSync(output,'utf8');}
 catch(error){throw new Error(exe+' falló: '+fs.readFileSync(output,'utf8'));}
 finally{fs.closeSync(fd);try{fs.unlinkSync(output);}catch{}}
};
if(!fs.existsSync(path.join(cluster,'PG_VERSION'))){const pw=path.join(data,'pg-init.password');fs.writeFileSync(pw,config.ownerPassword);try{run('initdb',['-D',cluster,'-U','superapp_owner','--pwfile='+pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{fs.unlinkSync(pw);}}
try{run('pg_ctl',['-D',cluster,'status']);}catch{run('pg_ctl',['-D',cluster,'-l',path.join(data,'postgres.log'),'-o',`-p ${config.port} -h 127.0.0.1`,'-w','start']);}
const env={PGPASSWORD:config.ownerPassword};
const args=['-h','127.0.0.1','-p',String(config.port),'-U','superapp_owner','-d','postgres','-v','ON_ERROR_STOP=1'];
if(!run('psql',[...args,'-tAc',"SELECT 1 FROM pg_database WHERE datname='superapp_affiliates'"] ,env).trim()){
run('psql',[...args,'-c','CREATE DATABASE superapp_affiliates'],env);
run('psql',[...args,'-c',`CREATE ROLE superapp_runtime LOGIN PASSWORD '${config.runtimePassword}' NOSUPERUSER NOBYPASSRLS`],env);
}
config.databaseUrl=`postgresql://superapp_runtime:${config.runtimePassword}@127.0.0.1:${config.port}/superapp_affiliates?schema=public`;
config.ownerUrl=`postgresql://superapp_owner:${config.ownerPassword}@127.0.0.1:${config.port}/superapp_affiliates?schema=public`;
fs.writeFileSync(configFile,JSON.stringify(config,null,2));
const dbargs=args.map(v=>v==='postgres'?'superapp_affiliates':v);
if(!run('psql',[...dbargs,'-tAc',`SELECT to_regclass('public."Tenant"')`],env).trim()){
 const migrationDirs=fs.readdirSync(path.join(root,'prisma/migrations')).filter(n=>fs.existsSync(path.join(root,'prisma/migrations',n,'migration.sql')));
 const base=fs.readFileSync(path.join(root,'prisma/migrations',migrationDirs.sort()[0],'migration.sql'),'utf8');
 const tables=['Tenant','Membership','App','Screen','DynamicSchema','DynamicRecord','AuditLog'];
 const blocks=base.split(/;\s*(?:\r?\n|$)/).filter(sql=>{
   const m=sql.match(/CREATE TABLE "([^"]+)"|CREATE (?:UNIQUE )?INDEX [\s\S]*? ON "([^"]+)"|ALTER TABLE "([^"]+)" ADD CONSTRAINT/);
   if(!m||!tables.includes(m[1]||m[2]||m[3]))return false;
   const ref=sql.match(/REFERENCES "([^"]+)"/);return !ref||tables.includes(ref[1]);
 }).map(s=>s+';');
 let sql=blocks.join('\n').replace(/^CREATE EXTENSION[^;]+;/gm,'');
 for(const t of tables)sql+=`\nALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;CREATE POLICY tenant_isolation ON "${t}" USING ("${t==='Tenant'?'id':'tenantId'}"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("${t==='Tenant'?'id':'tenantId'}"=nullif(current_setting('app.tenant_id',true),'')::uuid);`;
 sql+='\nGRANT USAGE ON SCHEMA public TO superapp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO superapp_runtime; REVOKE UPDATE,DELETE ON "AuditLog" FROM superapp_runtime;\n';
 sql+=base.slice(base.indexOf('CREATE OR REPLACE FUNCTION public.provision_dynamic_table()'));
 sql+='\n'+fs.readFileSync(path.join(root,'prisma/migrations/202609240002_affiliates/migration.sql'),'utf8');
 const filename=path.join(data,'local-core.sql');fs.writeFileSync(filename,'BEGIN;\n'+sql+'\nCOMMIT;');
 run('psql',[...dbargs,'-f',filename],env);
}
console.log('PostgreSQL local preparado: modelos centrales, formularios dinámicos y aislamiento RLS.');
