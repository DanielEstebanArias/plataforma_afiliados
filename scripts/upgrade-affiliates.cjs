const fs=require('node:fs'),path=require('node:path');const {execFileSync}=require('node:child_process');
const config=JSON.parse(fs.readFileSync('affiliates/data/superapp-local.json','utf8'));
const bin=path.join(process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/17/bin','psql.exe');
const args=['-h','127.0.0.1','-p',String(config.port),'-U','superapp_owner','-d','superapp_affiliates','-v','ON_ERROR_STOP=1'];
const options={env:{...process.env,PGPASSWORD:config.ownerPassword},windowsHide:true};
const exists=execFileSync(bin,[...args,'-tAc',`SELECT 1 FROM information_schema.columns WHERE table_name='AffiliateNetwork' AND column_name='approvalStatus'`],options).toString().trim();
if(!exists){const sql='BEGIN;\n'+fs.readFileSync('prisma/migrations/202609240003_communities/migration.sql','utf8')+'\nCOMMIT;';const file='affiliates/data/upgrade-communities.sql';fs.writeFileSync(file,sql);execFileSync(bin,[...args,'-f',path.resolve(file)],options);}
console.log('Esquema de comunidades y paneles preparado.');

const indexed=execFileSync(bin,[...args,'-tAc',`SELECT 1 FROM information_schema.columns WHERE table_name='AffiliateMember' AND column_name='ancestry'`],options).toString().trim();
if(!indexed){execFileSync(bin,[...args,'-1','-f',path.resolve('prisma/migrations/202609240004_tree_index/migration.sql')],options);}
