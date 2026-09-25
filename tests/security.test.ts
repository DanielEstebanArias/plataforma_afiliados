import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TenantContextManager } from '../src/security/tenant-context.manager';
import { SecretsService } from '../src/security/secrets.service';
import { approvedFetch } from '../src/core/outbound';
import { randomUUID } from 'node:crypto';
test('async tenant contexts do not bleed across concurrent requests', async () => {
  const context = new TenantContextManager();
  const first = randomUUID(),
    second = randomUUID();
  await Promise.all(
    [first, second].map((tenantId) =>
      context.run({ tenantId, subject: 'test', role: 'ADMIN' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(context.current().tenantId, tenantId);
      }),
    ),
  );
  assert.throws(() => context.current());
  await context.onModuleDestroy();
});
test('secret references cannot cross tenant namespaces', async () => {
  const context = new TenantContextManager();
  const first = randomUUID(),
    second = randomUUID();
  const secrets = new SecretsService(context);
  const key = 'TENANT_' + first.replace(/-/g, '').toUpperCase() + '_TEST_SECRET';
  process.env[key] = 'value';
  context.run({ tenantId: first, subject: 'test', role: 'ADMIN' }, () =>
    assert.equal(secrets.resolve('TEST_SECRET'), 'value'),
  );
  context.run({ tenantId: second, subject: 'test', role: 'ADMIN' }, () =>
    assert.throws(() => secrets.resolve('TEST_SECRET')),
  );
  delete process.env[key];
  await context.onModuleDestroy();
});
test('outbound policy rejects private and non-allowlisted URLs', async () => {
  process.env.OUTBOUND_HOSTS = 'api.stripe.com';
  await assert.rejects(approvedFetch('https://127.0.0.1/admin'));
  await assert.rejects(approvedFetch('http://api.stripe.com'));
  await assert.rejects(approvedFetch('https://secret@api.stripe.com'));
});
