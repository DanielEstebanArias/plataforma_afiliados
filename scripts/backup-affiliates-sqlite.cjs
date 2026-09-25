const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const target='affiliates/data/affiliates-before-superapp-consistent.sqlite';
if(fs.existsSync(target))throw new Error('El respaldo ya existe; no se sobrescribió.');
const db=new DatabaseSync('affiliates/data/affiliates.sqlite');
db.exec("VACUUM INTO 'affiliates/data/affiliates-before-superapp-consistent.sqlite'");
db.close();
const check=new DatabaseSync(target,{readOnly:true});
console.log('Respaldo consistente: '+check.prepare('SELECT count(*) AS n FROM members').get().n+' cuentas.');check.close();
