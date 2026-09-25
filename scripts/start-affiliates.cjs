const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
if(!fs.existsSync('affiliates/data/migration-report.json')){
 console.error('Falta integrar los datos. Sigue affiliates/INTEGRACION.md; no se iniciará una base antigua por accidente.');process.exit(1);
}
const setup=spawnSync(process.execPath,['scripts/setup-affiliates-postgres.cjs'],{stdio:'inherit',windowsHide:true});
if(setup.status!==0)process.exit(setup.status||1);
const upgrade=spawnSync(process.execPath,['scripts/upgrade-affiliates.cjs'],{stdio:'inherit',windowsHide:true});
if(upgrade.status!==0)process.exit(upgrade.status||1);
const result=spawnSync(process.execPath,['--import','tsx','src/affiliates/local.ts'],{stdio:'inherit',windowsHide:true});process.exit(result.status||0);
