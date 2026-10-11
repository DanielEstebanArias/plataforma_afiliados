import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkFeatures } from '../src/affiliates/features';

function setup(platformRoot = false, role = 'ROOT', targetPlatformRoot = false) {
  const updates: any[] = [];
  const network = {
    id: 'network',
    tenantId: 'tenant',
    platformRoot,
    modules: { access: false, dashboard: false, form: false },
  };
  const tx = {
    affiliateNetwork: {
      findFirst: async () => ({
        id: 'target',
        tenantId: 'tenant',
        appId: 'app',
        name: 'Nombre anterior',
        platformRoot: targetPlatformRoot,
      }),
      update: async (value: any) => {
        updates.push(value);
      },
    },
    app: {
      update: async (value: any) => {
        updates.push(value);
      },
    },
    affiliateSession: { deleteMany: async () => ({ count: 0 }) },
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
test('platform root can configure its own submodules', async () => {
  const modules = { access: true, dashboard: true, form: false };
  const { features, me, updates } = setup(true, 'ROOT', true);
  await features.updateModules(me, id, { modules });
  assert.deepEqual(updates[0].data.modules, { ...modules, createCommunities: false });
});
test('platform root can update its own approval status', async () => {
  const { features, me, updates } = setup(true, 'ROOT', true);
  await features.review(me, id, { status: 'APPROVED', note: '' });
  assert.equal(updates[0].data.approvalStatus, 'APPROVED');
});
test('superadministrator can rename every subregion and its linked app', async () => {
  const { features, me, updates } = setup(true, 'ROOT', true);
  const result = await features.renameCommunity(me, id, { name: '  Nuevo nombre  ' });
  assert.equal(result.name, 'Nuevo nombre');
  assert.deepEqual(updates[0], { where: { id: 'target' }, data: { name: 'Nuevo nombre' } });
  assert.deepEqual(updates[1], {
    where: { tenantId_id: { tenantId: 'tenant', id: 'app' } },
    data: { name: 'Nuevo nombre', revision: { increment: 1 } },
  });
});
test('member photo is restricted to levels with platform access', async () => {
  const updates: any[] = [];
  let query = 0;
  const tx = {
    $queryRaw: async () => (++query === 1 ? [{ id }] : [{ level: 3 }]),
    affiliateMember: { update: async (value: any) => updates.push(value) },
    auditLog: { create: async () => ({}) },
  };
  const features = new NetworkFeatures({
    tx: async (fn: any) =>
      fn(tx, { id, tenantId: 'tenant', maxLoginLevel: 2, platformRoot: false }),
  } as any);
  await assert.rejects(features.updateMemberPhoto(id, id, 'invalid'), {
    status: 403,
    message: 'Solo los aliados con acceso a la plataforma pueden cargar una foto.',
  });
  assert.equal(updates.length, 0);
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

test('platform root account can be updated without removing the protected network', async () => {
  const root = {
    id: 'root-member',
    tenantId: 'tenant',
    networkId: id,
    parentId: null,
    name: 'Administrador',
    email: 'admin@example.test',
    role: 'ROOT',
    status: 'active',
    data: {},
    createdAt: new Date(),
  };
  let saved: any;
  const network = {
    id,
    tenantId: 'tenant',
    appId: 'app',
    platformRoot: true,
    fields: [],
    schemaId: 'schema',
  };
  const tx = {
    affiliateNetwork: { findFirst: async () => network },
    affiliateMember: {
      findFirst: async ({ where }: any) => (where.role === 'ROOT' ? root : null),
      update: async ({ data }: any) => (saved = { ...root, ...data }),
    },
    affiliateSession: { deleteMany: async () => ({ count: 1 }) },
    dynamicRecord: { upsert: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const features = new NetworkFeatures({
    tx: async (fn: any) => fn(tx, network),
  } as any);
  await features.changeRoot(
    { id: root.id, role: 'ROOT' },
    id,
    {
      root: {
        name: 'José Ignacio Cano',
        email: 'jose@example.test',
        password: 'NuevaClaveSegura2026!',
      },
    },
  );
  assert.equal(saved.name, 'José Ignacio Cano');
  assert.equal(saved.email, 'jose@example.test');
  assert.match(saved.password, /^[0-9a-f]+:[0-9a-f]+$/);
});
