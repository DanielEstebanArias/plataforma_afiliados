import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import express from 'express';
import { AffiliatesStore, createForm, mirrorMember, column } from '../../src/affiliates/store';
import { mountAffiliates } from '../../src/affiliates/middleware';
const { createApp } = require('../../affiliates/server.cjs');
const filename = path.resolve('affiliates/data/superapp-local.json');
test(
  '10.000+ afiliados, permisos por nivel, aprobación, fotos y dashboard',
  { skip: !fs.existsSync(filename), timeout: 180000 },
  async () => {
    const cfg = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const db = new PrismaClient({ datasources: { db: { url: cfg.databaseUrl } } }),
      owner = new PrismaClient({ datasources: { db: { url: cfg.ownerUrl } } });
    const tenantId = randomUUID(),
      appId = randomUUID(),
      networkId = randomUUID(),
      rootId = randomUUID();
    const password = 'Scale-test-2026!',
      salt = randomUUID(),
      hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
    const store = new AffiliatesStore(db, tenantId, appId),
      app = createApp(store),
      engine = express();
    mountAffiliates(engine, db);
    let engineServer: any;
    const fields = [
      { id: 'city', label: 'Ciudad', type: 'text', required: false },
      { id: 'points', label: 'Puntos', type: 'number', required: false },
    ];
    const timings: Record<string, number> = {};
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
        await tx.tenant.create({ data: { id: tenantId, slug: 'scale-' + tenantId } });
        await tx.app.create({
          data: {
            id: appId,
            tenantId,
            name: 'Scale Test',
            bundleId: 'test.scale.a' + appId.replaceAll('-', ''),
          },
        });
        const schema = await createForm(tx, tenantId, appId, fields, 1);
        const n = await tx.affiliateNetwork.create({
          data: {
            id: networkId,
            appId,
            tenantId,
            name: 'Scale Test',
            fields,
            schemaId: schema.id,
            approvalStatus: 'APPROVED',
            platformRoot: true,
          },
        });
        const m = await tx.affiliateMember.create({
          data: {
            id: rootId,
            tenantId,
            networkId,
            name: 'Root',
            email: 'root@scale.test',
            password: hash,
            role: 'ROOT',
            data: { city: 'Bogotá', points: '10' },
          },
        });
        await mirrorMember(tx, n, m);
      });
      await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
      engineServer = engine.listen(0, '127.0.0.1');
      await new Promise<void>((r) => engineServer.once('listening', r));
      const base = 'http://127.0.0.1:' + app.server.address().port;
      const call = async (
        route: string,
        method = 'GET',
        body?: any,
        auth: any = {},
        origin = base,
      ) => {
        const r = await fetch(origin + '/api' + route, {
          method,
          headers: { 'Content-Type': 'application/json', ...auth },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') };
      };
      const login = async (email: string, origin = base) => {
        const r = await call('/login', 'POST', { email, password }, {}, origin);
        return {
          ...r,
          auth: { Cookie: r.cookie?.split(';')[0] || '', 'X-CSRF-Token': r.data.csrf },
        };
      };
      const root = await login('root@scale.test');
      assert.equal(root.status, 200);
      const add = async (
        name: string,
        parentId: string,
        auth = root.auth,
        pwd: string | undefined = password,
      ) =>
        call(
          '/members',
          'POST',
          {
            name,
            email: name + '@scale.test',
            parentId,
            password: pwd,
            data: { city: 'Cali', points: '5' },
          },
          auth,
        );
      const a = (await add('alice', rootId)).data.member;
      const alice = await login(a.email);
      const child = (await add('child', a.id, alice.auth)).data.member;
      const childLogin = await login(child.email);
      assert.equal(childLogin.status, 200);
      assert.equal((await call('/settings', 'PUT', { maxLoginLevel: 1 }, root.auth)).status, 200);
      assert.equal((await login(child.email)).status, 403);
      assert.equal((await call('/members', 'GET', undefined, childLogin.auth)).status, 403);
      assert.equal((await add('registered', a.id, alice.auth, undefined)).status, 201);
      // Omit password explicitly: an affiliate below the threshold still registers.
      assert.equal(
        (
          await call(
            '/members',
            'POST',
            { name: 'No login', email: 'no-login@scale.test', parentId: a.id, data: {} },
            alice.auth,
          )
        ).status,
        201,
      );
      assert.equal(
        (await call('/settings', 'PUT', { maxLoginLevel: null }, alice.auth)).status,
        403,
      );
      assert.equal(
        (await call('/members?parentId=' + rootId, 'GET', undefined, alice.auth)).status,
        404,
      );
      const bytes = fs.readFileSync(path.resolve('affiliates/web/icon-192.png'));
      const requested = await call(
        '/communities',
        'POST',
        { name: 'Pending Test', base64: bytes.toString('base64') },
        alice.auth,
      );
      assert.equal(requested.status, 201);
      const list = (await call('/communities', 'GET', undefined, root.auth)).data;
      const community = list.communities.find((c: any) => c.id === requested.data.id);
      assert.equal(community.approvalStatus, 'PENDING');
      assert.equal(community.hasPhoto, true);
      const communityUrl = `http://127.0.0.1:${engineServer.address().port}/affiliates/${tenantId}/${community.appId}`;
      assert.equal((await login(a.email, communityUrl)).status, 403);
      assert.equal(
        (await call('/communities/' + community.id, 'PUT', { status: 'APPROVED' }, alice.auth))
          .status,
        403,
      );
      assert.equal(
        (await call('/communities/' + community.id, 'PUT', { status: 'APPROVED' }, root.auth))
          .status,
        200,
      );
      const newRoot = await login(a.email, communityUrl);
      assert.equal(newRoot.status, 200);
      assert.equal(
        (await call('/settings', 'GET', undefined, newRoot.auth, communityUrl)).data.superuser,
        false,
      );
      assert.equal(
        (
          await call(
            '/communities/' + networkId,
            'PUT',
            { status: 'APPROVED' },
            newRoot.auth,
            communityUrl,
          )
        ).status,
        403,
      );
      const response = await fetch(base + '/api/communities/' + community.id + '/photo', {
        headers: root.auth,
      });
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal(
        (
          await call(
            '/communities/' + community.id,
            'PUT',
            { status: 'SUSPENDED', note: 'Test' },
            root.auth,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call('/members', 'GET', undefined, newRoot.auth, communityUrl)).status,
        401,
      );
      // Real database bulk insert: no data is written into the user's tenant.
      const started = performance.now();
      await store.tx(async (tx, n) => {
        await tx.$executeRaw`INSERT INTO "AffiliateMember" (id,"tenantId","networkId","parentId",name,email,password,role,status,data) SELECT gen_random_uuid(),${tenantId}::uuid,${networkId}::uuid,${rootId}::uuid,'Persona '||i,'person'||i||'@scale.test',${hash},'MEMBER','active',jsonb_build_object('city',CASE WHEN i%2=0 THEN 'Bogotá' ELSE 'Cali' END,'points',i::text) FROM generate_series(1,10050) i`;
        await tx.$executeRaw`INSERT INTO "DynamicRecord"(id,"tenantId","schemaId",data,"idempotencyKey") SELECT gen_random_uuid(),${tenantId}::uuid,${n.schemaId}::uuid,jsonb_build_object('name',m.name,'email',m.email,'parent_id',m."parentId"::text,'status',m.status,${column('city')},m.data->>'city',${column('points')},(m.data->>'points')::numeric),m.id::text FROM "AffiliateMember" m WHERE m."networkId"=${networkId}::uuid AND m.email LIKE 'person%@scale.test'`;
      });
      timings.insert10050 = Math.round(performance.now() - started);
      let t = performance.now();
      const page = await call('/members?limit=50', 'GET', undefined, root.auth);
      timings.page50 = Math.round(performance.now() - t);
      assert.equal(page.status, 200);
      assert.equal(page.data.members.length, 50);
      assert.equal(page.data.total, 10055);
      assert.ok(JSON.stringify(page.data).length < 60000);
      assert.ok(page.data.nextCursor);
      const next = await call(
        '/members?limit=50&after=' + page.data.nextCursor,
        'GET',
        undefined,
        root.auth,
      );
      assert.ok(
        next.data.members.every((m: any) => !page.data.members.some((p: any) => m.id === p.id)),
      );
      assert.equal((await call('/members?limit=10001', 'GET', undefined, root.auth)).status, 400);
      assert.equal(
        (await call('/members?q=person10050%40scale.test', 'GET', undefined, root.auth)).data.total,
        1,
      );
      t = performance.now();
      const stats = (await call('/stats', 'GET', undefined, root.auth)).data;
      timings.stats = Math.round(performance.now() - t);
      assert.equal(stats.total, 10055);
      assert.equal(stats.direct, 10051);
      const widgets = [
        { title: 'Ciudad', groupBy: 'city', metric: 'count', chart: 'bar' },
        { title: 'Puntos', groupBy: 'city', metric: 'sum', valueField: 'points', chart: 'kpi' },
        { title: 'Promedio', groupBy: 'city', metric: 'avg', valueField: 'points', chart: 'bar' },
      ];
      assert.equal((await call('/dashboard', 'PUT', { widgets }, root.auth)).status, 200);
      t = performance.now();
      const dashboard = await call('/dashboard', 'GET', undefined, root.auth);
      timings.dashboard3 = Math.round(performance.now() - t);
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.data.charts[0].total, 10055);
      assert.equal(dashboard.data.charts[1].total, (10050 * 10051) / 2 + 25);
      assert.equal(
        (
          await call(
            '/dashboard',
            'PUT',
            {
              widgets: [
                { title: 'Bad', groupBy: 'city', metric: 'sum', valueField: 'city', chart: 'bar' },
              ],
            },
            root.auth,
          )
        ).status,
        400,
      );
      const branchStats = (await call('/stats', 'GET', undefined, alice.auth)).data;
      assert.equal(branchStats.total, 4);
      const branchDash = (await call('/dashboard', 'GET', undefined, alice.auth)).data;
      assert.equal(branchDash.charts[0].records, 4);
      fs.writeFileSync(
        path.resolve('affiliates/data/scale-validation.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            members: 10055,
            timingsMs: timings,
            pageSize: 50,
            scope: 'isolated test tenant',
            passed: true,
          },
          null,
          2,
        ),
      );
      console.log('Mediciones locales (ms): ' + JSON.stringify(timings));
    } finally {
      await new Promise<void>((r) => app.server.close(() => r()));
      if (engineServer) await new Promise<void>((r) => engineServer.close(() => r()));
      await owner.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "tenant_${tenantId.replaceAll('-', '')}" CASCADE`,
      );
      await owner.tenant.deleteMany({ where: { id: tenantId } });
      await owner.auditLog.deleteMany({ where: { tenantId } });
      await db.$disconnect();
      await owner.$disconnect();
    }
  },
);
