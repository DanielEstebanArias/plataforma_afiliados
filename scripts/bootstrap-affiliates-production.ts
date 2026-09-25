import { PrismaClient } from '@prisma/client';
import { randomUUID, scryptSync } from 'node:crypto';
import { createForm, mirrorMember } from '../src/affiliates/store';
async function main(){
 const required=['DATABASE_URL','AFFILIATES_TENANT_ID','AFFILIATES_APP_ID','INITIAL_COMMUNITY_NAME','INITIAL_ROOT_NAME','INITIAL_ROOT_EMAIL','INITIAL_ROOT_PASSWORD'];
 for(const key of required)if(!process.env[key])throw Error('Falta '+key);
 if(process.env.INITIAL_ROOT_PASSWORD!.length<12)throw Error('La contraseña inicial requiere al menos 12 caracteres.');
 const db=new PrismaClient();
 try{
  const result=await db.$transaction(async tx=>{
   const roles=await tx.$queryRaw<any[]>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
   if(roles[0].rolsuper||roles[0].rolbypassrls)throw Error('Usa el rol limitado superapp_runtime.');
   const tenantId=process.env.AFFILIATES_TENANT_ID||randomUUID(),appId=process.env.AFFILIATES_APP_ID||randomUUID();
   await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
   if(await tx.tenant.findUnique({where:{id:tenantId}}))throw Error('La entidad ya existe; no se sobrescribió.');
   await tx.tenant.create({data:{id:tenantId,slug:'afiliados-'+tenantId,subscriptionStatus:'ACTIVE'}});
   await tx.app.create({data:{id:appId,tenantId,name:process.env.INITIAL_COMMUNITY_NAME!,bundleId:'com.afiliados.a'+appId.replaceAll('-','')}});
   const fields=[{id:'phone',label:'Teléfono',type:'tel',required:false},{id:'city',label:'Ciudad',type:'text',required:false}];
   const schema=await createForm(tx,tenantId,appId,fields,1);
   const n=await tx.affiliateNetwork.create({data:{id:randomUUID(),tenantId,appId,name:process.env.INITIAL_COMMUNITY_NAME!,fields,schemaId:schema.id,approvalStatus:'APPROVED',platformRoot:true}});
   const salt=randomUUID(),password=salt+':'+scryptSync(process.env.INITIAL_ROOT_PASSWORD!,salt,64).toString('hex');
   const m=await tx.affiliateMember.create({data:{id:randomUUID(),tenantId,networkId:n.id,name:process.env.INITIAL_ROOT_NAME!,email:process.env.INITIAL_ROOT_EMAIL!.trim().toLowerCase(),password,role:'ROOT',data:{}}});
   await mirrorMember(tx,n,m);
   return {AFFILIATES_TENANT_ID:tenantId,AFFILIATES_APP_ID:appId};
  },{timeout:30000});
  console.log(JSON.stringify(result,null,2));
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('No se creó la comunidad. Revisa variables, contraseña, rol y que la entidad no exista.');process.exit(1);});
