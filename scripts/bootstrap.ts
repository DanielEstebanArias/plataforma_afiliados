import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
async function main() {
  const [slug, subject] = process.argv.slice(2);
  z.string()
    .regex(/^[a-z0-9-]{3,63}$/)
    .parse(slug);
  z.string().min(1).parse(subject);
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
  try {
    const tenantId = randomUUID();
    const tenant = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
      return tx.tenant.create({
        data: {
          id: tenantId,
          slug,
          subscriptionStatus: 'ACTIVE',
          members: { create: { subject, role: 'OWNER' } },
        },
      });
    });
    console.log(
      JSON.stringify(
        {
          tenantId: tenant.id,
          slug: tenant.slug,
          oidcClaim: { tenant_id: tenant.id },
          secretPrefix: 'TENANT_' + tenant.id.replace(/-/g, '').toUpperCase() + '_',
          workerTenant: tenant.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
void main();
