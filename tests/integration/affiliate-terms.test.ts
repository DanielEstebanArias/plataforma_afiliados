import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AffiliatesStore, createForm } from '../../src/affiliates/store';
const { createApp } = require('../../affiliates/server.cjs');

test('terms: first acceptance, updates, community scope, admin permissions and immutable records',
  { skip: !process.env.TEST_ADMIN_DATABASE_URL || !process.env.TEST_RUNTIME_DATABASE_URL }, async () => {
    const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_ADMIN_DATABASE_URL } } });
    const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_RUNTIME_DATABASE_URL } } });
    const tenantId = randomUUID(), otherTenant = randomUUID();
    const password = 'Terms-test-password-2026', salt = randomUUID();
    const hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
    const accounts: any[] = [];
    const servers: any[] = [];
    try {
      for (const [tenant, principal] of [[tenantId, true], [tenantId, false], [otherTenant, true]] as const) {
        const appId = randomUUID(), networkId = randomUUID(), rootId = randomUUID(), memberId = randomUUID();
        await owner.$transaction(async tx => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenant},true)`;
          await tx.tenant.upsert({ where: { id: tenant }, create: { id: tenant, slug: 'terms-' + tenant }, update: {} });
          await tx.app.create({ data: { id: appId, tenantId: tenant, name: 'Terms Test', bundleId: 'test.' + appId } });
          const schema = await createForm(tx, tenant, appId, [], 1);
          await tx.affiliateNetwork.create({ data: { id: networkId, appId, tenantId: tenant,
            name: 'Terms Test', fields: [], schemaId: schema.id, platformRoot: principal, approvalStatus: 'APPROVED' } });
          for (const [id, role, parentId] of [[rootId, 'ROOT', null], [memberId, 'MEMBER', rootId]])
            await tx.affiliateMember.create({ data: { id: id!, role: role!, parentId, tenantId: tenant,
              networkId, name: role!, email: id + '@test.example', password: hash, data: {} } });
        });
        const app = createApp(new AffiliatesStore(db, tenant, appId));
        servers.push(app.server);
        await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = 'http://127.0.0.1:' + app.server.address().port;
        const call = async (route: string, method = 'GET', body?: any, auth: any = {}) => {
          const res = await fetch(base + '/api' + route, { method,
            headers: { 'Content-Type': 'application/json', ...auth },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
          return { status: res.status, data: await res.json() };
        };
        const login = async (id: string) => {
          const result = await call('/login', 'POST', { email: id + '@test.example', password, native: true });
          assert.equal(result.status, 200);
          return { Authorization: 'Bearer ' + result.data.token, 'X-CSRF-Token': result.data.csrf };
        };
        accounts.push({ rootId, memberId, networkId, appId, call, root: await login(rootId), member: await login(memberId) });
      }
      const a = accounts[0], b = accounts[1], other = accounts[2];
      const call = (route: string, method = 'GET', body?: any, auth = a.root) => a.call(route, method, body, auth);
      assert.equal((await call('/stats')).status, 200, 'existing access before first publication');
      assert.equal((await call('/terms')).data.required, false);
      const publish = (expectedVersionId: string | null, content: string) => call('/terms/publish', 'POST', {
        title: 'Condiciones', content, confirmPublish: true, expectedVersionId });
      const first = await publish(null, 'Texto versión uno');
      assert.equal(first.status, 201);
      assert.equal(first.data.version, 1);
      assert.equal((await call('/stats')).status, 428);
      assert.equal((await call('/me')).data.terms.required, true);
      assert.equal((await call('/communities/' + b.networkId + '/admin/members')).status, 428);
      assert.equal((await call('/terms/manage', 'GET', undefined, a.member)).status, 403);
      assert.equal((await b.call('/terms/manage', 'GET', undefined, b.root)).status, 403);
      assert.equal((await other.call('/terms', 'GET', undefined, other.root)).data.current, null);
      assert.equal((await b.call('/terms', 'GET', undefined, b.member)).data.current.id, first.data.id);
      assert.equal((await call('/terms/accept', 'POST', { versionId: first.data.id, accepted: false })).status, 400);
      assert.equal((await call('/terms/accept', 'POST', { versionId: first.data.id, accepted: true },
        { Authorization: a.root.Authorization })).status, 403, 'CSRF remains mandatory');
      const accept = (versionId: string, auth = a.root) => call('/terms/accept', 'POST', { versionId, accepted: true }, auth);
      assert.equal((await accept(first.data.id)).status, 200);
      assert.equal((await accept(first.data.id)).status, 200, 'acceptance is idempotent');
      assert.equal((await call('/stats')).status, 200);
      assert.equal((await call('/stats', 'GET', undefined, a.member)).status, 428, 'acceptance is per account');
      assert.equal((await accept(first.data.id, a.member)).status, 200);
      const second = await publish(first.data.id, 'Texto versión dos');
      assert.equal(second.status, 201);
      assert.equal((await call('/stats', 'GET', undefined, a.member)).status, 428, 'existing sessions gated after update');
      assert.equal((await accept(first.data.id, a.member)).status, 409, 'cannot accept an obsolete document');
      assert.equal((await accept(second.data.id, a.member)).status, 200);
      assert.equal((await call('/stats', 'GET', undefined, a.member)).status, 200);
      assert.equal((await b.call('/stats', 'GET', undefined, b.member)).status, 428);
      const history = (await call('/terms/manage')).data.versions;
      assert.deepEqual(history.map((v: any) => v.version), [2, 1]);
      assert.equal(history[1].content, 'Texto versión uno');
      const concurrent = await Promise.all([publish(second.data.id, 'Versión tres A'), publish(second.data.id, 'Versión tres B')]);
      assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${otherTenant},true)`;
        assert.equal(await tx.affiliateTermsVersion.count(), 0, 'RLS prevents cross-tenant access');
        assert.equal(await tx.affiliateTermsAcceptance.count(), 0);
      });
      const records = await owner.affiliateTermsAcceptance.findMany({ where: { tenantId } });
      assert.equal(records.length, 3);
      assert.ok(records.every(r => r.acceptedAt instanceof Date));
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
        await tx.$executeRaw`UPDATE "AffiliateTermsVersion" SET content='changed' WHERE id=${first.data.id}::uuid`;
      }), /permission denied/);
      assert.equal((await call('/logout', 'POST')).status, 200, 'logout available while acceptance is pending');
    } finally {
      for (const server of servers) await new Promise<void>(resolve => server.close(resolve));
      await owner.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } });
      await db.$disconnect(); await owner.$disconnect();
    }
  });
