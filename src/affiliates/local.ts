import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { TenantContextManager } from '../security/tenant-context.manager';
import { affiliatesHandler, mountAffiliates } from './middleware';
import fs from 'node:fs';
import path from 'node:path';
@Module({ providers: [TenantContextManager] })
class LocalCoreModule {}
async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.resolve('affiliates/data/superapp-local.json'), 'utf8'),
  );
  process.env.DATABASE_URL = config.databaseUrl;
  const app = await NestFactory.create(LocalCoreModule, { bodyParser: false });
  const prisma = new PrismaClient();
  mountAffiliates(app,prisma);
  app.use(affiliatesHandler(prisma, config.tenantId, config.appId));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4180), '127.0.0.1');
  console.log('SuperApp · Afiliados integrado en http://localhost:' + (process.env.PORT || 4180));
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
