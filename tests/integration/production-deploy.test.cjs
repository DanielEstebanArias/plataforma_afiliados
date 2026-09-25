const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const filename='affiliates/data/superapp-local.json';
test('Production bootstrap and server on a separate PostgreSQL database',{skip:!fs.existsSync(filename),timeout:90000},async()=>{
 const cfg=JSON.parse(fs.readFileSync(filename,'utf8'));
 const dbName='deploy_test_'+randomUUID().replaceAll('-','');
 const owner=new URL(cfg.ownerUrl),runtime=new URL(cfg.databaseUrl);owner.pathname='/'+dbName;runtime.pathname='/'+dbName;
 const bin=process.env.PSQL_BIN||'C:/Program Files/PostgreSQL/17/bin/psql.exe';
 const sql=(query,url=cfg.ownerUrl)=>{const u=new URL(url);u.searchParams.delete('schema');const r=spawnSync(bin,['-X','-w','-q','-v','ON_ERROR_STOP=1','-d',u.href],{input:query,env:{...process.env,PGCONNECT_TIMEOUT:'10'},encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,'Database command failed');};
 sql(`CREATE DATABASE "${dbName}";`);
 let running;
 const saved={...process.env};
 try{
  const env={...process.env,PSQL_BIN:bin,DATABASE_OWNER_URL:owner.href,RUNTIME_DB_PASSWORD:cfg.runtimePassword,DATABASE_URL:runtime.href,AFFILIATES_TENANT_ID:randomUUID(),AFFILIATES_APP_ID:randomUUID(),INITIAL_COMMUNITY_NAME:'Deploy Test',INITIAL_ROOT_NAME:'Test Root',INITIAL_ROOT_EMAIL:'root@deploy.test',INITIAL_ROOT_PASSWORD:'Test-deploy-password-2026',ALLOWED_ORIGINS:'https://frontend.example',PORT:'0'};
  for(const command of ['deploy/railway/prepare-db.cjs','deploy/railway/prepare-db.cjs','dist/scripts/bootstrap-affiliates-production.js']){
   const r=spawnSync(process.execPath,[command],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,command+' failed: '+r.stderr);
  }
  Object.assign(process.env,env);
  running=await require('../../dist/src/affiliates/production.js').startProduction();
  const base='http://127.0.0.1:'+running.app.getHttpServer().address().port;
  assert.equal((await fetch(base+'/healthz')).status,200);
  const route='/affiliates/'+env.AFFILIATES_TENANT_ID+'/'+env.AFFILIATES_APP_ID;
  assert.equal((await fetch(base+route+'/api/status')).status,200);
  const login=await fetch(base+route+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://frontend.example'},body:JSON.stringify({email:env.INITIAL_ROOT_EMAIL,password:env.INITIAL_ROOT_PASSWORD})});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.match(login.headers.get('set-cookie'),/; Secure/);assert.ok(login.headers.get('set-cookie').includes('Path='+route+'/'));
  const cookie=login.headers.get('set-cookie').split(';')[0],data=await login.json();
  const stats=await fetch(base+route+'/api/stats',{headers:{Cookie:cookie}});assert.equal((await stats.json()).total,1);
  const blocked=await fetch(base+route+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':data.csrf,Origin:'https://untrusted.example'},body:JSON.stringify({maxLoginLevel:1})});assert.equal(blocked.status,403);
  const update=await fetch(base+route+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':data.csrf,Origin:'https://frontend.example'},body:JSON.stringify({maxLoginLevel:1})});assert.equal(update.status,200);
 }finally{
  if(running){await running.app.close();await running.prisma.$disconnect();}
  for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
  sql(`DROP DATABASE "${dbName}" WITH (FORCE);`);
 }
});
