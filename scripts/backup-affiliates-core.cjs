const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
const config=JSON.parse(fs.readFileSync('affiliates/data/superapp-local.json','utf8'));
const target=path.resolve('affiliates/data/superapp-backup-'+new Date().toISOString().replaceAll(':','-')+'.dump');
execFileSync(path.join(process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/17/bin','pg_dump.exe'),['-h','127.0.0.1','-p',String(config.port),'-U','superapp_owner','-d','superapp_affiliates','-Fc','-f',target],{env:{...process.env,PGPASSWORD:config.ownerPassword},windowsHide:true,stdio:'inherit'});
console.log('Respaldo PostgreSQL creado en '+target);
