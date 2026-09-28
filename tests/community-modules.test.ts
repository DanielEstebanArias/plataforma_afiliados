import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkFeatures } from '../src/affiliates/features';

function setup(platformRoot = false, role = 'ROOT') {
  const updates: any[] = [];
  const network = {
    id: 'network',
    tenantId: 'tenant',
    platformRoot,
    modules: { access: false, dashboard: false, form: false },
  };
  const tx = {
    affiliateNetwork: {
      findFirst: async () => ({ id: 'target', platformRoot: false }),
      update: async (value: any) => {
        updates.push(value);
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const features = new NetworkFeatures({
    tenantId: 'tenant',
    tx: async (fn: any) => fn(tx, network),
  } as any);
  return { features, updates, me: { id: 'actor', role } };
}
const id = '11111111-1111-4111-8111-111111111111';
test('disabled modules reject direct backend access', async () => {
  const { features, me } = setup();
  for (const key of ['access', 'dashboard', 'form'] as const)
    await assert.rejects(features.requireModule(key), { status: 403 });
  await assert.rejects(features.dashboard(me), { status: 403 });
  await assert.rejects(features.settings(me, { maxLoginLevel: null }), { status: 403 });
});
test('only platform root can configure modules', async () => {
  const modules = { access: true, dashboard: false, form: true };
  for (const [platformRoot, role] of [
    [false, 'ROOT'],
    [true, 'MEMBER'],
  ] as const) {
    const { features, me, updates } = setup(platformRoot, role);
    await assert.rejects(features.updateModules(me, id, { modules }), { status: 403 });
    assert.equal(updates.length, 0);
  }
  const { features, me, updates } = setup(true);
  await features.updateModules(me, id, { modules });
  assert.deepEqual(updates[0].data.modules, { ...modules, createCommunities: false });
  await features.requireModule('dashboard');
});
test('module configuration requires explicit boolean values for all modules', async () => {
  const { features, me } = setup(true);
  for (const modules of [
    null,
    {},
    { access: 'false', dashboard: true, form: true },
    { access: true, dashboard: true, form: true, unknown: true },
  ])
    await assert.rejects(features.updateModules(me, id, { modules }), { status: 400 });
});
test('community requires an independent root identity and valid password', async () => {
  const { features, me } = setup(true);
  for (const root of [
    undefined,
    { name: 'Root', email: 'invalid', password: 'long-password' },
    { name: 'Root', email: 'root@example.test', password: 'short' },
  ])
    await assert.rejects(features.requestCommunity(me, { name: 'Community', root }), {
      status: 400,
    });
});
