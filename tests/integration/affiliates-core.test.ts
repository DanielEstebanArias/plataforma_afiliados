import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AffiliatesStore, createForm, mirrorMember } from '../../src/affiliates/store';
import { mountAffiliates } from '../../src/affiliates/middleware';
import express from 'express';
const { createApp } = require('../../affiliates/server.cjs');
const configPath = path.resolve('affiliates/data/superapp-local.json');
test(
  'Afiliados usa modelos centrales, versiones, RLS y permisos por rama',
  { skip: !fs.existsSync(configPath) },
  async () => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
    const owner = new PrismaClient({ datasources: { db: { url: config.ownerUrl } } });
    const tenantId = randomUUID(),
      appId = randomUUID(),
      networkId = randomUUID(),
      rootId = randomUUID();
    const password = 'Prueba-Afiliados-2026',
      salt = 'test-random-' + randomUUID(),
      hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
    const app = createApp(new AffiliatesStore(db, tenantId, appId));
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
        await tx.tenant.create({ data: { id: tenantId, slug: 'test-' + tenantId } });
        await tx.app.create({
          data: {
            id: appId,
            tenantId,
            name: 'Test Afiliados',
            bundleId: 'test.afiliados.a' + appId.replaceAll('-', ''),
          },
        });
        const schema = await createForm(tx, tenantId, appId, [], 1);
        const n = await tx.affiliateNetwork.create({
          data: { id: networkId, tenantId, appId, name: 'Test', fields: [], schemaId: schema.id, approvalStatus:'APPROVED',platformRoot:true },
        });
        const root = await tx.affiliateMember.create({
          data: {
            id: rootId,
            tenantId,
            networkId,
            name: 'Root Test',
            email: 'root@example.test',
            password: hash,
            role: 'ROOT',
            data: {},
          },
        });
        await mirrorMember(tx, n, root);
      });
      await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + app.server.address().port;
      const call = async (route: string, method = 'GET', body?: any, auth: any = {}) => {
        const r = await fetch(base + '/api' + route, {
          method,
          headers: { 'Content-Type': 'application/json', ...auth },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, data: await r.json(), headers: r.headers };
      };
      const login = async (email: string) => {
        const r = await call('/login', 'POST', { email, password });
        assert.equal(r.status, 200);
        return { Cookie: r.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': r.data.csrf };
      };
      const rootAuth = await login('root@example.test');
      assert.equal(
        (await call('/me', 'GET', null, rootAuth)).data.organization.integration.appId,
        appId,
      );
      const add = async (name: string, parentId: string, auth: any = rootAuth, data = {}) =>
        call(
          '/members',
          'POST',
          { name, email: name + '@example.test', password, parentId, data },
          auth,
        );
    const a = (await add('alice', rootId)).data.member,
      b = (await add('bob', rootId)).data.member;
    assert.equal((await add('alice',rootId)).status,409);
      const alice = await login(a.email),
        child = (await add('child', a.id, alice)).data.member;
      assert.deepEqual(
        new Set((await call('/members', 'GET', null, alice)).data.members.map((m: any) => m.id)),
        new Set([a.id, child.id]),
      );
      assert.equal((await add('blocked', b.id, alice)).status, 404);
      assert.equal((await call('/superapp', 'GET', null, alice)).status, 403);
      const fields = [{ id: 'city', label: 'Ciudad', type: 'text', required: true }];
      assert.equal((await call('/fields', 'PUT', { fields }, rootAuth)).status, 200);
      assert.equal((await add('missing', a.id, alice)).status, 400);
      assert.equal((await add('valid', a.id, alice, { city: 'Bogotá' })).status, 201);
      const summary = (await call('/superapp', 'GET', null, rootAuth)).data;
      assert.equal(summary.formVersion, 2);
      assert.equal(summary.schemas.length, 2);
      assert.equal(summary.app.revision, 2);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
        assert.equal(await tx.dynamicRecord.count(), 5);
        assert.equal(await tx.affiliateMember.count(), 5);
      assert.ok((await tx.auditLog.count()) >= 4);
      assert.ok(await tx.auditLog.count({where:{actor:'affiliate:'+a.id}})>0);
        const other = randomUUID();
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${other},true)`;
        assert.equal(await tx.affiliateMember.count(), 0);
        assert.equal(await tx.dynamicRecord.count(), 0);
        assert.equal(await tx.app.count(), 0);
      });
      const bytes = fs.readFileSync(path.resolve('affiliates/web/icon-192.png'));
      assert.equal(
        (
          await call(
            '/members/' + child.id + '/photo',
            'PUT',
            { base64: bytes.toString('base64') },
            alice,
          )
        ).status,
        200,
      );
      const bob = await login(b.email);
      assert.equal((await call('/members/' + child.id + '/photo', 'GET', null, bob)).status, 404);
      const r = await fetch(base + '/api/members/' + child.id + '/photo', { headers: rootAuth });
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
      const engine=express();
      mountAffiliates(engine,db);
      const engineServer=engine.listen(0,'127.0.0.1');
      await new Promise<void>(resolve=>engineServer.once('listening',resolve));
      try {
        const port=(engineServer.address() as any).port;
        const moduleUrl=`http://127.0.0.1:${port}/affiliates/${tenantId}/${appId}/`;
        assert.equal((await fetch(moduleUrl)).status,200);
        assert.equal((await fetch(moduleUrl+'tree.js')).status,200);
        const moduleLogin=await fetch(moduleUrl+'api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'root@example.test',password})});
        assert.equal(moduleLogin.status,200);
        const cookie=moduleLogin.headers.get('set-cookie')!;
        assert.ok(cookie.startsWith('af_'+appId+'='));
        assert.ok(cookie.includes(`Path=/affiliates/${tenantId}/${appId}/`));
        const detail=await fetch(moduleUrl+'api/superapp',{headers:{Cookie:cookie.split(';')[0]}});
        assert.equal(detail.status,200);
        assert.equal((await detail.json()).app.id,appId);
      } finally {await new Promise<void>(r=>engineServer.close(()=>r()));}
    } finally {
      await new Promise<void>((r) => app.server.close(() => r()));
      // Cleanup only this randomly generated test tenant, with its generated dependent tables.
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
