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
        {
          name: 'Pending Test',
          base64: bytes.toString('base64'),
          root: { name: 'Community Root', email: 'community@scale.test', password },
          modules: { access: false, dashboard: false, form: false },
        },
        root.auth,
      );
      assert.equal(requested.status, 201);
      const list = (await call('/communities', 'GET', undefined, root.auth)).data;
      const community = list.communities.find((c: any) => c.id === requested.data.id);
      assert.equal(community.approvalStatus, 'PENDING');
      assert.equal(community.hasPhoto, true);
      const communityUrl = `http://127.0.0.1:${engineServer.address().port}/affiliates/${tenantId}/${community.appId}`;
      assert.equal((await login('community@scale.test')).status, 403);
      assert.equal(
        (
          await call('/login', 'POST', {
            email: 'community@scale.test',
            password: 'Incorrect-password',
          })
        ).status,
        401,
      );
      assert.equal((await login('community@scale.test', communityUrl)).status, 403);
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
      const newRoot = await login('community@scale.test', communityUrl);
      assert.equal(newRoot.status, 200);
      const communityRequest = {
        name: 'Requested by permitted community',
        root: { name: 'Nested Root', email: 'nested@scale.test', password },
        modules: { access: false, dashboard: false, form: false, createCommunities: false },
      };
      assert.equal((await call('/communities', 'POST', communityRequest, alice.auth)).status, 403);
      assert.equal(
        (await call('/communities', 'POST', communityRequest, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (await call('/communities', 'GET', undefined, newRoot.auth, communityUrl)).data.canCreate,
        false,
      );
      await call(
        '/communities/' + community.id + '/modules',
        'PUT',
        {
          modules: { access: false, dashboard: false, form: false, createCommunities: true },
        },
        root.auth,
      );
      assert.equal(
        (await call('/communities', 'GET', undefined, newRoot.auth, communityUrl)).data.canCreate,
        true,
      );
      const nested = await call(
        '/communities',
        'POST',
        communityRequest,
        newRoot.auth,
        communityUrl,
      );
      assert.equal(nested.status, 201);
      assert.equal(nested.data.status, 'PENDING');
      assert.equal(
        (
          await call(
            '/communities',
            'POST',
            {
              ...communityRequest,
              modules: { ...communityRequest.modules, createCommunities: true },
            },
            newRoot.auth,
            communityUrl,
          )
        ).status,
        403,
      );
      await call(
        '/communities/' + community.id + '/modules',
        'PUT',
        {
          modules: { access: false, dashboard: false, form: false, createCommunities: false },
        },
        root.auth,
      );
      assert.equal(
        (await call('/communities', 'POST', communityRequest, newRoot.auth, communityUrl)).status,
        403,
      );
      const automaticLogin = await login('community@scale.test');
      assert.equal(automaticLogin.status, 200);
      assert.equal(automaticLogin.data.redirectUrl, `/affiliates/${tenantId}/${community.appId}/`);
      assert.ok(automaticLogin.cookie?.startsWith('af_' + community.appId + '='));
      assert.ok(automaticLogin.cookie?.includes('Path=' + automaticLogin.data.redirectUrl));
      const automaticMe = await call('/me', 'GET', undefined, automaticLogin.auth, communityUrl);
      assert.equal(automaticMe.status, 200);
      assert.equal(automaticMe.data.user.id, newRoot.data.user.id);
      assert.equal(automaticMe.data.organization.name, 'Pending Test');
      assert.equal((await call('/me', 'GET', undefined, automaticLogin.auth)).status, 401);
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
      assert.equal((await login(a.email, communityUrl)).status, 401);
      assert.equal(
        (await call('/dashboard', 'GET', undefined, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (await call('/fields', 'PUT', { fields: [] }, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (await call('/settings', 'PUT', { maxLoginLevel: null }, newRoot.auth, communityUrl))
          .status,
        403,
      );
      const adminPrefix = '/communities/' + community.id + '/admin';
      assert.equal(
        (await call(adminPrefix + '/settings', 'GET', undefined, alice.auth)).status,
        403,
      );
      assert.equal(
        (await call(adminPrefix + '/settings', 'GET', undefined, newRoot.auth, communityUrl))
          .status,
        403,
      );
      assert.equal(
        (
          await call(
            '/communities/' + randomUUID() + '/admin/settings',
            'GET',
            undefined,
            root.auth,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call(
            adminPrefix + '/settings',
            'PUT',
            { maxLoginLevel: 1 },
            { Cookie: root.auth.Cookie },
          )
        ).status,
        403,
      );
      const selectedSettings = await call(
        adminPrefix + '/settings',
        'PUT',
        { maxLoginLevel: 1 },
        root.auth,
      );
      assert.equal(selectedSettings.status, 200);
      assert.equal(selectedSettings.data.id, community.id);
      assert.equal(selectedSettings.data.superuser, true);
      const parallelSettings = await Promise.all([
        call('/settings', 'GET', undefined, root.auth),
        call(adminPrefix + '/settings', 'GET', undefined, root.auth),
      ]);
      assert.equal(parallelSettings[0].data.id, networkId);
      assert.equal(parallelSettings[1].data.id, community.id);
      assert.equal(
        (await call(adminPrefix + '/dashboard', 'GET', undefined, root.auth)).status,
        200,
      );
      assert.equal(
        (
          await call(
            adminPrefix + '/dashboard',
            'PUT',
            {
              widgets: [
                { title: 'Community count', groupBy: '$status', metric: 'count', chart: 'kpi' },
              ],
            },
            root.auth,
          )
        ).status,
        200,
      );
      const selectedFields = [
        ...fields,
        { id: 'zone', label: 'Zona', type: 'text', required: false },
      ];
      assert.equal(
        (await call(adminPrefix + '/fields', 'PUT', { fields: selectedFields }, root.auth)).status,
        200,
      );
      assert.equal(
        (await call('/me', 'GET', undefined, root.auth)).data.organization.fields.length,
        fields.length,
      );
      assert.equal(
        (await call(adminPrefix + '/me', 'GET', undefined, root.auth)).data.organization.fields
          .length,
        selectedFields.length,
      );
      assert.equal(
        (await call(adminPrefix + '/members/' + rootId, 'GET', undefined, root.auth)).status,
        404,
      );
      const adminCreatedCommunity = await call(
        adminPrefix + '/communities',
        'POST',
        {
          name: 'Admin created from selected',
          root: { name: 'Another Root', email: 'another@scale.test', password },
          modules: { access: true, dashboard: true, form: true, createCommunities: true },
        },
        root.auth,
      );
      assert.equal(adminCreatedCommunity.status, 201);
      assert.equal(
        (await call('/dashboard', 'GET', undefined, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (
          await call(
            '/communities/' + community.id + '/modules',
            'PUT',
            {
              modules: { access: true, dashboard: true, form: true },
            },
            root.auth,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call('/dashboard', 'GET', undefined, newRoot.auth, communityUrl)).status,
        200,
      );
      const rootRoute = '/communities/' + community.id + '/root';
      const replacement = {
        root: {
          name: 'Replacement Root',
          email: 'replacement@scale.test',
          password: 'Replacement-2026!',
        },
      };
      const descendant = await call(
        '/members',
        'POST',
        {
          name: 'Preserved child',
          email: 'preserved@scale.test',
          parentId: newRoot.data.user.id,
          password,
          data: {},
        },
        newRoot.auth,
        communityUrl,
      );
      assert.equal(descendant.status, 201);
      const adminUpdatedMember = await call(
        adminPrefix + '/members/' + descendant.data.member.id,
        'PUT',
        {
          name: 'Preserved child',
          email: 'preserved@scale.test',
          status: 'active',
          data: { city: 'Cali', zone: 'Norte' },
        },
        root.auth,
      );
      assert.equal(adminUpdatedMember.status, 200);
      assert.equal(
        (
          await call(
            adminPrefix + '/members/' + descendant.data.member.id + '/photo',
            'PUT',
            { base64: bytes.toString('base64') },
            root.auth,
          )
        ).status,
        200,
      );
      const treePath = '/communities/' + community.id + '/tree';
      const adminTree = await call(treePath, 'GET', undefined, root.auth);
      assert.equal(adminTree.status, 200);
      assert.equal(adminTree.data.organization.name, 'Pending Test');
      assert.equal(adminTree.data.root.id, newRoot.data.user.id);
      assert.equal(adminTree.data.stats.total, 2);
      assert.equal(
        adminTree.data.members.some((m: any) => m.id === rootId),
        false,
      );
      assert.equal(
        (await call(treePath + '?parentId=' + newRoot.data.user.id, 'GET', undefined, root.auth))
          .data.members[0].id,
        descendant.data.member.id,
      );
      assert.equal(
        (
          await call(
            treePath + '/members/' + descendant.data.member.id,
            'GET',
            undefined,
            root.auth,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call(treePath + '/members/' + rootId, 'GET', undefined, root.auth)).status,
        404,
      );
      assert.equal(
        (await call(treePath + '?parentId=' + rootId, 'GET', undefined, root.auth)).status,
        404,
      );
      assert.equal((await call(treePath, 'GET', undefined, alice.auth)).status, 403);
      assert.equal(
        (await call(treePath, 'GET', undefined, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (await call('/communities/' + randomUUID() + '/tree', 'GET', undefined, root.auth)).status,
        404,
      );
      const automaticMember = await login('preserved@scale.test');
      assert.equal(automaticMember.status, 200);
      assert.equal(automaticMember.data.redirectUrl, automaticLogin.data.redirectUrl);
      assert.equal(automaticMember.data.user.role, 'MEMBER');
      assert.equal(
        (await call('/me', 'GET', undefined, automaticMember.auth, communityUrl)).status,
        200,
      );
      assert.equal((await call(rootRoute, 'PUT', replacement, alice.auth)).status, 403);
      assert.equal(
        (await call(rootRoute, 'PUT', replacement, newRoot.auth, communityUrl)).status,
        403,
      );
      assert.equal(
        (await call('/communities/' + networkId + '/root', 'PUT', replacement, root.auth)).status,
        403,
      );
      assert.equal(
        (
          await call(
            rootRoute,
            'PUT',
            { root: { ...replacement.root, password: 'short' } },
            root.auth,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            rootRoute,
            'PUT',
            { root: { ...replacement.root, email: 'preserved@scale.test' } },
            root.auth,
          )
        ).status,
        409,
      );
      assert.equal((await call('/me', 'GET', undefined, newRoot.auth, communityUrl)).status, 200);
      const changedRoot = await call(rootRoute, 'PUT', replacement, root.auth);
      assert.equal(changedRoot.status, 200);
      assert.equal(changedRoot.data.root.id, newRoot.data.user.id);
      assert.equal((await call('/me', 'GET', undefined, newRoot.auth, communityUrl)).status, 401);
      assert.equal((await login('community@scale.test', communityUrl)).status, 401);
      assert.equal((await login(replacement.root.email, communityUrl)).status, 401);
      const replacementLogin = await call('/login', 'POST', replacement.root, {}, communityUrl);
      assert.equal(replacementLogin.status, 200);
      const replacementAuth = {
        Cookie: replacementLogin.cookie!.split(';')[0],
        'X-CSRF-Token': replacementLogin.data.csrf,
      };
      const preserved = await call('/members', 'GET', undefined, replacementAuth, communityUrl);
      assert.equal(
        preserved.data.members.find((m: any) => m.id === descendant.data.member.id).parentId,
        newRoot.data.user.id,
      );
      const updatedList = await call('/communities', 'GET', undefined, root.auth);
      assert.equal(
        updatedList.data.communities.find((c: any) => c.id === community.id).root.email,
        replacement.root.email,
      );
      assert.equal(JSON.stringify(updatedList.data).includes('password'), false);
      const automaticReplacement = await call('/login', 'POST', replacement.root);
      assert.equal(automaticReplacement.status, 200);
      assert.equal(automaticReplacement.data.redirectUrl, automaticLogin.data.redirectUrl);
      const secondCommunity = await call(
        '/communities',
        'POST',
        {
          name: 'Second matching community',
          root: replacement.root,
          modules: { access: true, dashboard: true, form: true },
        },
        root.auth,
      );
      assert.equal(secondCommunity.status, 201);
      await call(
        '/communities/' + secondCommunity.data.id,
        'PUT',
        { status: 'APPROVED' },
        root.auth,
      );
      const multiple = await call('/login', 'POST', replacement.root);
      assert.equal(multiple.status, 200);
      assert.equal(multiple.data.communities.length, 2);
      assert.equal(multiple.cookie, null);
      assert.equal(multiple.data.token, undefined);
      assert.equal(
        (await call('/login', 'POST', { ...replacement.root, communityAppId: appId })).status,
        401,
      );
      const selectedLogin = await call('/login', 'POST', {
        ...replacement.root,
        communityAppId: community.appId,
      });
      assert.equal(selectedLogin.status, 200);
      assert.equal(selectedLogin.data.redirectUrl, automaticLogin.data.redirectUrl);
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
      assert.equal(
        (await call('/login', 'POST', { ...replacement.root, communityAppId: community.appId }))
          .status,
        403,
      );
      // Real database bulk insert: no data is written into the user's tenant.
      const started = performance.now();
      await store.tx(
        async (tx, n) => {
          await tx.$executeRaw`INSERT INTO "AffiliateMember" (id,"tenantId","networkId","parentId",name,email,password,role,status,data) SELECT gen_random_uuid(),${tenantId}::uuid,${networkId}::uuid,${rootId}::uuid,'Persona '||i,'person'||i||'@scale.test',${hash},'MEMBER','active',jsonb_build_object('city',CASE WHEN i%2=0 THEN 'Bogotá' ELSE 'Cali' END,'points',i::text) FROM generate_series(1,10050) i`;
          await tx.$executeRaw`INSERT INTO "DynamicRecord"(id,"tenantId","schemaId",data,"idempotencyKey") SELECT gen_random_uuid(),${tenantId}::uuid,${n.schemaId}::uuid,jsonb_build_object('name',m.name,'email',m.email,'parent_id',m."parentId"::text,'status',m.status,${column('city')},m.data->>'city',${column('points')},(m.data->>'points')::numeric),m.id::text FROM "AffiliateMember" m WHERE m."networkId"=${networkId}::uuid AND m.email LIKE 'person%@scale.test'`;
        },
        { timeout: 60000 },
      );
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
      const exported = await fetch(base + '/api/communities/export.csv', { headers: root.auth });
      assert.equal(exported.status, 200);
      assert.ok(exported.headers.get('content-type')?.startsWith('text/csv'));
      const csv = await exported.text();
      const rows = csv
        .replace(/^\ufeff/, '')
        .trimEnd()
        .split('\r\n')
        .map((line) =>
          [...line.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map((match) =>
            match[1].replace(/""/g, '"'),
          ),
        );
      const columns = rows.shift()!;
      const zoneColumn = columns.indexOf('Campo: Zona [text]');
      const cityColumn = columns.indexOf('Campo: Ciudad [text]');
      assert.ok(zoneColumn > 0 && cityColumn > 0);
      const childExport = rows.find((row) => row[2] === descendant.data.member.id)!;
      assert.equal(childExport[0], 'Pending Test');
      assert.equal(childExport[zoneColumn], 'Norte');
      assert.equal(childExport[cityColumn], 'Cali');
      assert.equal(rows.find((row) => row[2] === rootId)![zoneColumn], '');
      const expectedCount = await store.tx((tx) =>
        tx.affiliateMember.count({ where: { tenantId } }),
      );
      assert.equal(rows.length, expectedCount);
      assert.equal(rows.filter((row) => row[1] === networkId).length, 10055);
      assert.equal(csv.includes(hash), false);
      assert.equal(csv.includes(password), false);
      assert.equal(
        (await fetch(base + '/api/communities/export.csv', { headers: alice.auth })).status,
        403,
      );
      const audits = await store.tx((tx) =>
        tx.auditLog.findMany({
          where: { tenantId, action: 'community.access.updated', resourceId: community.id },
        }),
      );
      assert.ok(audits.some((audit) => audit.actor === 'affiliate:' + rootId));
      const deletePath = '/communities/' + community.id;
      const confirmation = { confirmName: 'Pending Test' };
      assert.equal((await call(deletePath, 'DELETE', confirmation, alice.auth)).status, 403);
      assert.equal(
        (await call(deletePath, 'DELETE', confirmation, { Cookie: root.auth.Cookie })).status,
        403,
      );
      assert.equal(
        (await call(deletePath, 'DELETE', { confirmName: 'Wrong name' }, root.auth)).status,
        400,
      );
      assert.equal(
        (
          await call(
            '/communities/' + networkId,
            'DELETE',
            { confirmName: 'Scale Test' },
            root.auth,
          )
        ).status,
        403,
      );
      assert.equal(
        (await call('/communities/' + randomUUID(), 'DELETE', confirmation, root.auth)).status,
        404,
      );
      await call(deletePath, 'PUT', { status: 'APPROVED' }, root.auth);
      const beforeDelete = await call('/login', 'POST', replacement.root, {}, communityUrl);
      assert.equal(beforeDelete.status, 200);
      const beforeDeleteAuth = {
        Cookie: beforeDelete.cookie!.split(';')[0],
        'X-CSRF-Token': beforeDelete.data.csrf,
      };
      assert.equal(
        (await call(deletePath, 'DELETE', confirmation, beforeDeleteAuth, communityUrl)).status,
        403,
      );
      const schemaIds = await store.tx((tx) =>
        tx.dynamicSchema.findMany({
          where: { tenantId, appId: community.appId },
          select: { id: true },
        }),
      );
      assert.equal((await call(deletePath, 'DELETE', confirmation, root.auth)).status, 200);
      const remaining = await store.tx(async (tx) => ({
        network: await tx.affiliateNetwork.count({ where: { tenantId, id: community.id } }),
        app: await tx.app.count({ where: { tenantId, id: community.appId } }),
        members: await tx.affiliateMember.count({ where: { tenantId, networkId: community.id } }),
        sessions: await tx.affiliateSession.count({ where: { tenantId, networkId: community.id } }),
        schemas: await tx.dynamicSchema.count({ where: { tenantId, appId: community.appId } }),
        records: await tx.dynamicRecord.count({
          where: { tenantId, schemaId: { in: schemaIds.map((s) => s.id) } },
        }),
      }));
      assert.deepEqual(remaining, {
        network: 0,
        app: 0,
        members: 0,
        sessions: 0,
        schemas: 0,
        records: 0,
      });
      assert.equal(
        (await call('/me', 'GET', undefined, beforeDeleteAuth, communityUrl)).status,
        404,
      );
      assert.equal((await call(deletePath, 'DELETE', confirmation, root.auth)).status, 404);
      assert.equal((await call('/stats', 'GET', undefined, root.auth)).data.total, 10055);
      const afterDelete = await call('/communities', 'GET', undefined, root.auth);
      assert.equal(
        afterDelete.data.communities.some((c: any) => c.id === community.id),
        false,
      );
      assert.ok(afterDelete.data.communities.some((c: any) => c.id === nested.data.id));
      const deletionAudit = await store.tx((tx) =>
        tx.auditLog.findFirst({
          where: { tenantId, action: 'community.deleted', resourceId: community.id },
        }),
      );
      assert.equal(deletionAudit?.actor, 'affiliate:' + rootId);
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
