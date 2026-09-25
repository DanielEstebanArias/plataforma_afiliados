const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('Registro, permisos por rama, formulario, fotos y persistencia', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afiliados-test-')),
    file = path.join(dir, 'test.sqlite');
  let app = createApp(file);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (route, method = 'GET', body, auth = {}) => {
    const r = await fetch(base + '/api' + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  const pwd = 'Example-secure-123';
  const login = async (email) => {
    const r = await call('/login', 'POST', { email, password: pwd });
    assert.equal(r.status, 200);
    return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': r.data.csrf };
  };
  try {
    assert.equal((await call('/members')).status, 401);
    assert.equal(
      (
        await call('/setup', 'POST', {
          organization: 'Test',
          name: 'Root',
          email: 'root@example.test',
          password: pwd,
        })
      ).status,
      201,
    );
    assert.equal((await call('/setup', 'POST', {})).status, 409);
    const root = await login('root@example.test');
    const rootId = (await call('/me', 'GET', null, root)).data.user.id;
    const add = async (name, parentId, auth = root, data = {}) =>
      call(
        '/members',
        'POST',
        { name, email: name + '@example.test', password: pwd, parentId, data },
        auth,
      );
    const a = (await add('Alice', rootId)).data.member,
      b = (await add('Bob', rootId)).data.member;
    const alice = await login(a.email);
    const child = (await add('Child', a.id, alice)).data.member;
    const visible = (await call('/members', 'GET', null, alice)).data.members;
    assert.deepEqual(new Set(visible.map((m) => m.id)), new Set([a.id, child.id]));
    assert.equal(visible.find((m) => m.id === a.id).parentId, null);
    assert.equal((await add('Intruder', b.id, alice)).status, 404);
    assert.equal(
      (await call('/members/' + b.id, 'PUT', { name: 'Changed', email: b.email, data: {} }, alice))
        .status,
      404,
    );
    assert.equal(
      (await call('/members/' + b.id + '/photo', 'PUT', { base64: 'xx' }, alice)).status,
      404,
    );
    assert.equal((await call('/fields', 'PUT', { fields: [] }, alice)).status, 403);
    assert.equal((await call('/members', 'POST', {}, { Cookie: root.Cookie })).status, 403);
    const fields = [
      { id: 'city', label: 'Ciudad', type: 'select', required: true, options: ['Bogotá', 'Cali'] },
    ];
    assert.equal((await call('/fields', 'PUT', { fields }, root)).status, 200);
    assert.equal((await add('Missing', rootId)).status, 400);
    assert.equal((await add('Invalid', rootId, root, { city: 'Unknown' })).status, 400);
    assert.equal((await add('Valid', rootId, root, { city: 'Cali' })).status, 201);
    const photo = fs.readFileSync(path.join(__dirname, '../web/icon-192.png')).toString('base64');
    assert.equal(
      (await call('/members/' + child.id + '/photo', 'PUT', { base64: photo }, alice)).status,
      200,
    );
    assert.equal(
      (await fetch(base + '/api/members/' + child.id + '/photo', { headers: root })).status,
      200,
    );
    const bob = await login(b.email);
    assert.equal((await call('/members/' + child.id + '/photo', 'GET', null, bob)).status, 404);
    assert.equal(
      (
        await call(
          '/members/' + b.id,
          'PUT',
          { name: 'Bob', email: b.email, status: 'inactive', data: { city: 'Cali' } },
          root,
        )
      ).status,
      200,
    );
    assert.equal((await call('/members', 'GET', null, bob)).status, 401);
    assert.equal(
      (
        await call(
          '/members/' + rootId,
          'PUT',
          { name: 'Root', email: 'root@example.test', status: 'inactive', data: { city: 'Cali' } },
          root,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call('/login', 'POST', { email: 'root@example.test', password: 'wrong' })).status,
      401,
    );
    assert.equal((await call('/logout', 'POST', {}, alice)).status, 200);
    assert.equal((await call('/me', 'GET', null, alice)).status, 401);
    await new Promise((r) => app.server.close(r));
    app.db.close();
    app = createApp(file);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM members').get().n, 5);
    assert.ok(
      app.db.prepare('SELECT photo FROM members WHERE id=?').get(child.id).photo.length > 0,
    );
    assert.deepEqual(
      JSON.parse(app.db.prepare('SELECT fields FROM organization').get().fields),
      fields,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
