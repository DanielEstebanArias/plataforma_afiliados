// Demonstration only: isolated in-memory database, discarded when stopped.
const { createApp } = require('./server.cjs');
const { server } = createApp(':memory:');
server.listen(4181, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:4181/api';
  let auth = {};
  async function request(p, b) {
    const r = await fetch(base + p, {
      method: b ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...auth },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    return { data: await r.json(), headers: r.headers };
  }
  const password = 'DemoAfiliados2026!';
  await request('/setup', {
    organization: 'DEMOSTRACIÓN · Comunidad Horizonte',
    name: 'Elena Martínez',
    email: 'raiz@example.test',
    password,
  });
  const login = await request('/login', { email: 'raiz@example.test', password });
  auth = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': login.data.csrf };
  async function add(name, email, parentId, city) {
    return (
      await request('/members', {
        name,
        email,
        parentId,
        password,
        data: { city, phone: '000 000 0000' },
      })
    ).data.member.id;
  }
  const root = login.data.user.id;
  const a = await add('Camila Torres', 'camila@example.test', root, 'Bogotá');
  const b = await add('Andrés Rojas', 'andres@example.test', root, 'Medellín');
  await add('Lucía Gómez', 'lucia@example.test', a, 'Bogotá');
  await add('Mateo Díaz', 'mateo@example.test', a, 'Cali');
  await add('Sofía Castro', 'sofia@example.test', b, 'Medellín');
  console.log('DEMO lista: http://127.0.0.1:4181 — raiz@example.test / DemoAfiliados2026!');
});
