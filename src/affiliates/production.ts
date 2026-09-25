import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { TenantContextManager } from '../security/tenant-context.manager';
import { affiliatesHandler, mountAffiliates } from './middleware';
@Module({ providers: [TenantContextManager] })
class ProductionAffiliatesModule {}
export async function startProduction() {
  for (const key of ['DATABASE_URL', 'AFFILIATES_TENANT_ID', 'AFFILIATES_APP_ID', 'ALLOWED_ORIGINS']) {
    if (!process.env[key]) throw new Error(`Falta configurar ${key}`);
  }
  for (const key of ['AFFILIATES_TENANT_ID', 'AFFILIATES_APP_ID']) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(process.env[key]!)) throw new Error(`${key} inválido`);
  }
  const origins = process.env.ALLOWED_ORIGINS!.split(',').map(s => s.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['https:', 'capacitor:'].includes(url.protocol) || url.origin !== origin && origin !== 'capacitor://localhost') throw new Error('ALLOWED_ORIGINS debe contener orígenes HTTPS exactos');
  }
  process.env.ALLOWED_ORIGINS = origins.join(',');
  process.env.SECURE_COOKIES = 'true';
  const prisma = new PrismaClient();
  const app = await NestFactory.create(ProductionAffiliatesModule, { bodyParser: false });
  app.use('/healthz', async (_req: any, res: any) => {
    try { await prisma.$queryRaw`SELECT 1`; res.setHeader('Cache-Control','no-store'); res.status(200).json({status:'ok'}); }
    catch { res.status(503).json({status:'unavailable'}); }
  });
  // Resolve the default community under the same tenant restrictions as normal requests.
  const handler = affiliatesHandler(prisma, process.env.AFFILIATES_TENANT_ID!, process.env.AFFILIATES_APP_ID!);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id',${process.env.AFFILIATES_TENANT_ID!},true)`;
    await tx.affiliateNetwork.findUniqueOrThrow({where:{appId:process.env.AFFILIATES_APP_ID!}});
  });
  mountAffiliates(app, prisma);
  app.use(handler);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  return { app, prisma };
}
if (require.main === module)
  startProduction().catch((error: any) => {
    console.error('No se pudo iniciar Afiliados:', error?.message || error);
    if (process.env.NODE_ENV !== 'production') console.error(error?.stack || error);
    process.exit(1);
  });
