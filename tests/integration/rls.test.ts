import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
const enabled = !!process.env.TEST_ADMIN_DATABASE_URL && !!process.env.TEST_RUNTIME_DATABASE_URL;
test(
  'PostgreSQL RLS denies cross-tenant reads, writes and composite relationships',
  { skip: !enabled },
  async () => {
    const admin = new PrismaClient({
      datasources: { db: { url: process.env.TEST_ADMIN_DATABASE_URL } },
    });
    const runtime = new PrismaClient({
      datasources: { db: { url: process.env.TEST_RUNTIME_DATABASE_URL } },
    });
    const a = randomUUID(),
      b = randomUUID();
    try {
      await admin.tenant.createMany({
        data: [
          { id: a, slug: 'test-' + a },
          { id: b, slug: 'test-' + b },
        ],
      });
      const appA = await admin.app.create({
        data: { tenantId: a, name: 'A', bundleId: 'test.a.' + a.replace(/-/g, '') },
      });
      const appB = await admin.app.create({
        data: { tenantId: b, name: 'B', bundleId: 'test.b.' + b.replace(/-/g, '') },
      });
      const roles = await runtime.$queryRaw<
        {
          rolsuper: boolean;
          rolbypassrls: boolean;
        }[]
      >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      assert.equal(roles[0].rolsuper, false);
      assert.equal(roles[0].rolbypassrls, false);
      assert.equal(await runtime.app.count(), 0);
      await runtime.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${a},true)`;
        const schema = await tx.dynamicSchema.create({
          data: {
            tenantId: a,
            appId: appA.id,
            name: 'measurements',
            fields: [{ name: 'temperature', type: 'number', required: true }],
          },
        });
        const record = await tx.dynamicRecord.create({
          data: {
            tenantId: a,
            schemaId: schema.id,
            data: { temperature: 24.5 },
            idempotencyKey: randomUUID(),
          },
        });
        const namespace = 'tenant_' + a.replace(/-/g, ''),
          table = 'table_' + schema.id.replace(/-/g, '');
        const physical = await tx.$queryRawUnsafe<
          {
            temperature: number;
          }[]
        >('SELECT temperature FROM "' + namespace + '"."' + table + '"');
        assert.equal(physical[0].temperature, 24.5);
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${b},true)`;
        assert.equal(
          (await tx.$queryRawUnsafe<unknown[]>('SELECT * FROM "' + namespace + '"."' + table + '"'))
            .length,
          0,
        );
        assert.equal(await tx.dynamicRecord.findUnique({ where: { id: record.id } }), null);
      });
      await runtime.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${a},true)`;
        assert.deepEqual(
          (await tx.app.findMany()).map((x) => x.id),
          [appA.id],
        );
        assert.equal(await tx.app.findUnique({ where: { id: appB.id } }), null);
      });
      await assert.rejects(
        runtime.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${a},true)`;
          await tx.screen.create({
            data: { tenantId: a, appId: appB.id, route: '/', title: 'bad', tree: {} },
          });
        }),
      );
      await assert.rejects(
        runtime.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${a},true)`;
          await tx.app.create({
            data: {
              tenantId: b,
              name: 'bad',
              bundleId: 'test.bad.' + randomUUID().replace(/-/g, ''),
            },
          });
        }),
      );
      assert.equal(await runtime.app.count(), 0);
    } finally {
      await admin.tenant.deleteMany({ where: { id: { in: [a, b] } } });
      await runtime.$disconnect();
      await admin.$disconnect();
    }
  },
);
