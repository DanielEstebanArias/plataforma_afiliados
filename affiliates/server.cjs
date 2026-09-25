const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const uid = () => crypto.randomUUID();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200)
    fail(400, 'La contraseña debe tener entre 10 y 200 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function verify(password, hash) {
  const [salt, value] = hash.split(':');
  const actual = await scrypt(String(password).slice(0, 200), salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(value, 'hex'));
}
function createApp(
  database = process.env.AFFILIATES_DB || path.join(__dirname, 'data', 'affiliates.sqlite'),
) {
  if (typeof database === 'string' && database !== ':memory:')
    fs.mkdirSync(path.dirname(database), { recursive: true });
  const db = typeof database === 'string' ? new DatabaseSync(database) : database;
  if (!db.integrated)
    db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS organization(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL,fields TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES members(id),name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',data TEXT NOT NULL,photo BLOB,mime TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS members_parent ON members(parent_id);`);
  const defaults = [
    { id: 'phone', label: 'Teléfono', type: 'tel', required: false },
    { id: 'city', label: 'Ciudad', type: 'text', required: false },
  ];
  const org = async () => await (await db.prepare('SELECT * FROM organization WHERE id=1')).get();
  const member = async (id) => await (await db.prepare('SELECT * FROM members WHERE id=?')).get(id);
  const branch = async (id) =>
    await (
      await db.prepare(
        `WITH RECURSIVE tree(id) AS (SELECT id FROM members WHERE id=? UNION ALL SELECT m.id FROM members m JOIN tree t ON m.parent_id=t.id) SELECT m.* FROM members m JOIN tree t ON m.id=t.id ORDER BY m.created`,
      )
    ).all(id);
  const publicMember = (m) => ({
    id: m.id,
    parentId: m.parent_id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    data: JSON.parse(m.data),
    hasPhoto: !!m.photo,
    created: m.created,
  });
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const rates = new Map();
  async function validate(b) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 150)
      fail(400, 'Escribe un nombre válido.');
    if (typeof b.email !== 'string' || !/^\S+@\S+\.\S+$/.test(b.email) || b.email.length > 254)
      fail(400, 'Escribe un correo válido.');
    const data = b.data || {};
    if (typeof data !== 'object' || Array.isArray(data)) fail(400, 'Datos inválidos.');
    for (const f of JSON.parse((await org()).fields)) {
      const v = data[f.id];
      if (
        f.required &&
        (v === undefined || v === '' || v === null || (f.type === 'checkbox' && v !== true))
      )
        fail(400, `Completa ${f.label}.`);
      if (v === undefined || v === '' || v === null) continue;
      if (f.type === 'checkbox' ? typeof v !== 'boolean' : typeof v !== 'string' || v.length > 4000)
        fail(400, `Valor inválido: ${f.label}.`);
      if (f.type === 'select' && !f.options.includes(v))
        fail(400, `Selecciona una opción de ${f.label}.`);
      if (f.type === 'number' && !Number.isFinite(Number(v)))
        fail(400, `Número inválido: ${f.label}.`);
      if (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(v))
        fail(400, `Correo inválido: ${f.label}.`);
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
        fail(400, `Fecha inválida: ${f.label}.`);
    }
    return JSON.stringify(data);
  }
  async function body(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    let size = 0,
      chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 3000000) fail(413, 'Archivo demasiado grande.');
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch {
      fail(400, 'Solicitud inválida.');
    }
  }
  const handler = async (req, res) => {
    const cookieName = req.baseUrl && db.appId ? 'af_' + db.appId : 'af_session';
    const cookiePath = req.baseUrl ? req.baseUrl + '/' : '/';
    const origin = req.headers.origin;
    const localOrigin = `http://${req.headers.host}`;
    const allowed = [
      localOrigin,
      `https://${req.headers.host}`,
      ...(process.env.ALLOWED_ORIGINS || '').split(','),
    ];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token,Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }
    const send = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const method = req.method;
      if (method === 'OPTIONS') {
        res.writeHead(origin && allowed.includes(origin) ? 204 : 403);
        return res.end();
      }
      if (p.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method) && origin && !allowed.includes(origin))
          fail(403, 'Origen no autorizado.');
        if (p === '/api/status' && method === 'GET')
          return send({
            configured: !!(await org()),
            name: (await org())?.name || 'Plataforma Afiliados',
          });
        if (p === '/api/setup' && method === 'POST') {
          if (await org()) fail(409, 'La organización ya existe.');
          const b = await body(req);
          const password = await passwordHash(b.password);
          if (await org()) fail(409, 'La organización ya existe.');
          if (!b.name?.trim() || !/^\S+@\S+\.\S+$/.test(b.email || '') || !b.organization?.trim())
            fail(400, 'Completa organización, nombre y correo.');
          await db.exec('BEGIN');
          try {
            await (
              await db.prepare('INSERT INTO organization VALUES(1,?,?)')
            ).run(b.organization.slice(0, 150), JSON.stringify(defaults));
            await (
              await db.prepare(
                "INSERT INTO members(id,parent_id,name,email,password,role,data,created) VALUES(?,NULL,?,?,?,'ROOT','{}',?)",
              )
            ).run(
              uid(),
              b.name.trim().slice(0, 150),
              b.email.trim().toLowerCase(),
              password,
              new Date().toISOString(),
            );
            await db.exec('COMMIT');
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
          return send({ ok: true }, 201);
        }
        if (p === '/api/login' && method === 'POST') {
          const b = await body(req);
          // Per-account key remains stable behind Railway/Vercel proxies without trusting client IP headers.
          const key = hash(String(b.email || '').trim().toLowerCase());
          const now = Date.now();
          if (rates.size >= 10000) {
            for (const [k,v] of rates) if (v.until < now) rates.delete(k);
            if (rates.size >= 10000 && !rates.has(key)) fail(429, 'Demasiados intentos. Intenta más tarde.');
          }
          let rate = rates.get(key);
          if (!rate || rate.until < now) {
            rate = { count: 0, until: now + 900000 };
            rates.set(key, rate);
          }
          if (++rate.count > 30) fail(429, 'Demasiados intentos. Espera 15 minutos.');
          const m = await (
            await db.prepare('SELECT * FROM members WHERE email=?')
          ).get(String(b.email).trim().toLowerCase());
          if (!m || m.status !== 'active' || !(await verify(b.password, m.password)))
            fail(401, 'Correo o contraseña incorrectos.');
          if(db.features) await db.features.access(m.id);
          const token = crypto.randomBytes(32).toString('hex'),
            csrf = crypto.randomBytes(24).toString('hex');
          await (await db.prepare('DELETE FROM sessions WHERE expires<?')).run(now);
          await (
            await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
          ).run(hash(token), m.id, csrf, now + 86400000);
          res.setHeader(
            'Set-Cookie',
            `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=86400${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`,
          );
          return send({
            user: { ...publicMember(m), parentId: null },
            csrf,
            ...(b.native ? { token } : {}),
          });
        }
        const token =
          req.headers.authorization?.replace(/^Bearer /, '') ||
          req.headers.cookie
            ?.split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith(cookieName + '='))
            ?.slice(cookieName.length + 1);
        const session =
          token &&
          (await (
            await db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?')
          ).get(hash(token), Date.now()));
        const me = session && (await member(session.member_id));
        if (!me || me.status !== 'active') fail(401, 'Inicia sesión para continuar.');
        if(db.features) await db.features.access(me.id);
        db.setActor?.(me.id);
        if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf)
          fail(403, 'Sesión de formulario inválida. Recarga la página.');
        const visible = async (id) => {
          if(db.visible) return db.visible(me.id,id);
          const found = (await branch(me.id)).find((m) => m.id === id);
          if (!found) fail(404, 'Afiliado no disponible.');
          return found;
        };
        if (p === '/api/me' && method === 'GET')
          return send({
            user: { ...publicMember(me), parentId: null },
            csrf: session.csrf,
            organization: {
              name: (await org()).name,
              fields: JSON.parse((await org()).fields),
              integration: (await org()).integration,
            },
          });
        if(db.features){
          if(p==='/api/stats'&&method==='GET')return send(await db.features.stats(me.id));
          if(p==='/api/settings'&&['GET','PUT'].includes(method))return send(await db.features.settings(me,method==='PUT'?await body(req):undefined));
          if(p==='/api/communities'&&method==='GET')return send(await db.features.communities(me));
          if(p==='/api/communities'&&method==='POST')return send(await db.features.requestCommunity(me,await body(req)),201);
          if(p==='/api/dashboard'&&['GET','PUT'].includes(method))return send(await db.features.dashboard(me,method==='PUT'?await body(req):undefined,url.searchParams));
          const community=p.match(/^\/api\/communities\/([^/]+)(\/photo)?$/);
          if(community){
            if(community[2]&&['GET','PUT'].includes(method)){
              const input=method==='PUT'?(await body(req)).base64:undefined;
              if(method==='PUT' && typeof input!=='string') throw Object.assign(new Error('Selecciona una imagen.'),{status:400});
              const result=await db.features.communityPhoto(me,community[1],input);
              if(method==='GET'){res.writeHead(200,{'Content-Type':result.mime,'Cache-Control':'private, no-store'});return res.end(Buffer.from(result.bytes));}
              return send(result);
            }
            if(!community[2]&&method==='PUT')return send(await db.features.review(me,community[1],await body(req)));
          }
          if(p==='/api/members'&&method==='GET')return send(await db.features.page(me.id,url.searchParams));
          if(p==='/api/registration'&&method==='GET'){
            const parent=url.searchParams.get('parentId');await visible(parent);
            return send(await db.features.registration(parent));
          }
        }
        if (p === '/api/superapp' && method === 'GET') {
          if (me.role !== 'ROOT' || !db.integrated)
            fail(403, 'Solo la entidad raíz puede administrar esta aplicación.');
          return send(await db.catalog());
        }
        if (p === '/api/logout' && method === 'POST') {
          await (await db.prepare('DELETE FROM sessions WHERE token=?')).run(hash(token));
          res.setHeader(
            'Set-Cookie',
            `${cookieName}=; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=0`,
          );
          return send({ ok: true });
        }
        if (p === '/api/fields' && method === 'PUT') {
          if (me.role !== 'ROOT') fail(403, 'Solo la entidad raíz configura el formulario.');
          const b = await body(req);
          if (!Array.isArray(b.fields) || b.fields.length > 80)
            fail(400, 'Máximo 80 campos por formulario.');
          const ids = new Set();
          const fields = b.fields.map((f) => {
            if (
              !/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(f.id) ||
              ids.has(f.id) ||
              !f.label?.trim() ||
              f.label.length > 100 ||
              ![
                'text',
                'textarea',
                'email',
                'tel',
                'number',
                'date',
                'select',
                'checkbox',
              ].includes(f.type)
            )
              fail(400, 'Revisa los campos: identificador único, etiqueta y tipo.');
            ids.add(f.id);
            if (
              f.type === 'select' &&
              (!Array.isArray(f.options) ||
                !f.options.length ||
                f.options.some((v) => typeof v !== 'string' || v.length > 150))
            )
              fail(400, 'Agrega opciones válidas.');
            return {
              id: f.id,
              label: f.label.trim(),
              type: f.type,
              required: !!f.required,
              ...(f.type === 'select' ? { options: f.options } : {}),
            };
          });
          await (
            await db.prepare('UPDATE organization SET fields=? WHERE id=1')
          ).run(JSON.stringify(fields));
          return send({ fields });
        }
        if (p === '/api/members' && method === 'GET')
          return send({
            members: (await branch(me.id)).map((m) => ({
              ...publicMember(m),
              parentId: m.id === me.id ? null : m.parent_id,
            })),
          });
        if (p === '/api/members' && method === 'POST') {
          const b = await body(req);
          await visible(b.parentId);
          const data = await validate(b);
          const allowed = db.features ? (await db.features.registration(b.parentId)).loginAllowed : true;
          const password = await passwordHash(b.password || (!allowed ? crypto.randomBytes(24).toString('hex') : ''));
          const id = uid();
          await (
            await db.prepare(
              "INSERT INTO members(id,parent_id,name,email,password,role,data,created) VALUES(?,?,?,?,?,'MEMBER',?,?)",
            )
          ).run(
            id,
            b.parentId,
            b.name.trim(),
            b.email.trim().toLowerCase(),
            password,
            data,
            new Date().toISOString(),
          );
          return send({ member: publicMember(await member(id)) }, 201);
        }
        const match = p.match(/^\/api\/members\/([^/]+)(\/photo)?$/);
        if (match) {
          const m = await visible(match[1]);
          if(!match[2]&&method==='GET')return send({member:{...publicMember(m),parentId:m.id===me.id?null:m.parent_id}});
          if (match[2]) {
            if (method === 'GET') {
              if (!m.photo) fail(404, 'Sin foto.');
              res.writeHead(200, { 'Content-Type': m.mime, 'Cache-Control': 'private, no-store' });
              return res.end(m.photo);
            }
            if (method === 'PUT') {
              const b = await body(req);
              const bytes = Buffer.from(b.base64 || '', 'base64');
              const png = bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
              const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
              if (bytes.length > 2000000 || bytes.length < 12 || (!png && !jpeg))
                fail(400, 'Carga una imagen PNG o JPG de máximo 2 MB.');
              await (
                await db.prepare('UPDATE members SET photo=?,mime=? WHERE id=?')
              ).run(bytes, png ? 'image/png' : 'image/jpeg', m.id);
              return send({ ok: true });
            }
          } else if (method === 'PUT') {
            const b = await body(req);
            const data = await validate(b);
            const status = b.status === 'inactive' ? 'inactive' : 'active';
            if (m.id === me.id && status === 'inactive')
              fail(400, 'No puedes desactivar tu propia cuenta.');
            const pwd = b.password ? await passwordHash(b.password) : null;
            await (
              await db.prepare('UPDATE members SET name=?,email=?,data=?,status=? WHERE id=?')
            ).run(b.name.trim(), b.email.trim().toLowerCase(), data, status, m.id);
            if (status === 'inactive')
              await (await db.prepare('DELETE FROM sessions WHERE member_id=?')).run(m.id);
            if (pwd) {
              await (await db.prepare('UPDATE members SET password=? WHERE id=?')).run(pwd, m.id);
              await (await db.prepare('DELETE FROM sessions WHERE member_id=?')).run(m.id);
            }
            return send({ member: publicMember(await member(m.id)) });
          }
        }
        fail(404, 'Ruta no disponible.');
      }
      const file = path.join(__dirname, 'web', p === '/' ? 'index.html' : decodeURIComponent(p));
      if (
        !file.startsWith(path.join(__dirname, 'web') + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      )
        fail(404, 'Página no encontrada.');
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(
        {
          error:
            e.code === 'P2002' || (e.code === 'ERR_SQLITE_ERROR' && e.message.includes('UNIQUE'))
              ? 'Este correo ya está registrado.'
              : e.status
                ? e.message
                : 'No se pudo completar la operación.',
        },
        e.status || (e.code === 'P2002' || (e.message || '').includes('UNIQUE') ? 409 : 500),
      );
      if (!e.status && e.code !== 'P2002' && !String(e.message).includes('UNIQUE'))
        console.error(e);
    }
  };
  const server = http.createServer((req, res) =>
    db.request ? db.request(() => handler(req, res)) : handler(req, res),
  );
  return { server, db };
}
if (require.main === module) {
  if (!process.env.AFFILIATES_DB && fs.existsSync(path.join(__dirname,'data','migration-report.json'))) {
    console.error('Esta instalación ya está integrada. Usa npm run affiliates desde SuperApp para evitar modificar la base anterior.');
    process.exit(1);
  }
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 4180), process.env.HOST || '127.0.0.1', () =>
    console.log(`Plataforma Afiliados disponible en http://localhost:${process.env.PORT || 4180}`),
  );
}
module.exports = { createApp };
