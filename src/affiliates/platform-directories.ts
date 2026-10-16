import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createForm, mirrorMember } from './store';

const scrypt = promisify(scryptCallback);
const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

async function passwordHash(password: string) {
  if (password.length < 10 || password.length > 200)
    fail(400, 'La contraseña debe tener entre 10 y 200 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + ((await scrypt(password, salt, 64)) as Buffer).toString('hex');
}

async function verifyPassword(password: string, stored: string) {
  const [salt, value] = String(stored).split(':');
  if (!salt || !/^[0-9a-f]{128}$/i.test(value || '')) return false;
  const actual = (await scrypt(String(password).slice(0, 200), salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(value, 'hex'));
}

async function requestBody(req: any) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) fail(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    fail(400, 'Solicitud inválida.');
  }
}

const cleanText = (value: unknown, label: string, max = 150) => {
  if (typeof value !== 'string') fail(400, `${label} no es válido.`);
  const text = (value as string).trim();
  if (!text || text.length > max)
    fail(400, `${label} no es válido.`);
  return text;
};
const cleanColor = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400, `${label} no es válido.`);
  return (value as string).toLowerCase();
};

export function platformDirectoriesHandler(
  prisma: PrismaClient,
  defaultTenantId: string,
  defaultAppId: string,
) {
  const attempts = new Map<string, { count: number; until: number }>();
  return async (req: any, res: any) => {
    const send = (value: unknown, status = 200) => {
      res.status(status).set('Cache-Control', 'no-store').json(value);
    };
    try {
      const url = new URL(req.originalUrl || req.url, 'http://localhost');
      const path = url.pathname.replace(/^\/api\/platform/, '') || '/';
      const method = req.method;
      if (path === '/status' && method === 'GET')
        return send({ configured: (await prisma.platformAdministrator.count()) > 0 });
      if (path === '/login' && method === 'POST') {
        const body = await requestBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const now = Date.now();
        let rate = attempts.get(email);
        if (!rate || rate.until < now) rate = { count: 0, until: now + 15 * 60_000 };
        attempts.set(email, rate);
        if (++rate.count > 20) fail(429, 'Demasiados intentos. Espera 15 minutos.');
        if (!emailPattern.test(email) || typeof body.password !== 'string')
          fail(401, 'Correo o contraseña incorrectos.');
        const administrator = await prisma.platformAdministrator.findUnique({ where: { email } });
        if (!administrator) fail(401, 'Correo o contraseña incorrectos.');
        const signedInAdministrator = administrator!;
        if (signedInAdministrator.status !== 'ACTIVE' || !(await verifyPassword(body.password, signedInAdministrator.password)))
          fail(401, 'Correo o contraseña incorrectos.');
        const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('hex');
        await prisma.platformAdminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        await prisma.platformAdminSession.create({ data: {
          tokenDigest: digest(token), administratorId: signedInAdministrator.id, csrf,
          expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        }});
        res.setHeader('Set-Cookie', `platform_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; Secure`);
        return send({ administrator: { id: signedInAdministrator.id, name: signedInAdministrator.name, email: signedInAdministrator.email }, csrf });
      }
      const rawCookie = String(req.headers.cookie || '').split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith('platform_session='));
      const token = rawCookie?.slice('platform_session='.length);
      const session = token ? await prisma.platformAdminSession.findFirst({
        where: { tokenDigest: digest(token), expiresAt: { gt: new Date() } },
        include: { administrator: true },
      }) : null;
      if (!session) fail(401, 'Inicia sesión como gran superadministrador.');
      const activeSession = session!;
      if (activeSession.administrator.status !== 'ACTIVE') fail(401, 'Inicia sesión como gran superadministrador.');
      if (!['GET', 'HEAD'].includes(method) && req.headers['x-csrf-token'] !== activeSession.csrf)
        fail(403, 'Sesión inválida. Recarga la página.');
      const administrator = activeSession.administrator;
      if (path === '/me' && method === 'GET')
        return send({ administrator: { id: administrator.id, name: administrator.name, email: administrator.email }, csrf: activeSession.csrf });
      if (path === '/directories' && method === 'GET') {
        const directories = await prisma.platformDirectory.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
        const enriched = await Promise.all(directories.map(async (directory) => {
          const primaryDivisionName = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id',${directory.tenantId},true)`;
            return (await tx.app.findUnique({ where: { tenantId_id: { tenantId: directory.tenantId, id: directory.rootAppId } }, select: { name: true } }))?.name || '';
          });
          return { ...directory, id: directory.id, primaryDivisionName, url: `/affiliates/${directory.tenantId}/${directory.rootAppId}/` };
        }));
        return send({ directories: enriched });
      }
      if (path === '/directories' && method === 'POST') {
        const body = await requestBody(req);
        const name = cleanText(body.name, 'El nombre del directorio');
        const slogan = cleanText(body.slogan, 'El eslogan', 200);
        const divisionLabel = cleanText(body.divisionLabel, 'El nombre de las divisiones', 80);
        const primaryColor = cleanColor(body.primaryColor, 'El color principal');
        const secondaryColor = cleanColor(body.secondaryColor, 'El color secundario');
        const accentColor = cleanColor(body.accentColor, 'El color de acento');
        const backgroundColor = cleanColor(body.backgroundColor, 'El color de fondo');
        const primaryDivisionName = cleanText(body.primaryDivisionName, 'El nombre de la división principal');
        const adminName = cleanText(body.adminName, 'El nombre del superadministrador');
        const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
        if (!emailPattern.test(adminEmail) || adminEmail.length > 254) fail(400, 'El correo del superadministrador no es válido.');
        if (typeof body.adminPassword !== 'string') fail(400, 'Indica una contraseña inicial.');
        const password = await passwordHash(body.adminPassword);
        const tenantId = randomUUID(), appId = randomUUID(), networkId = randomUUID(), memberId = randomUUID();
        const templateFields = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${defaultTenantId},true)`;
          const network = await tx.affiliateNetwork.findUnique({ where: { appId: defaultAppId }, select: { fields: true } });
          return (network?.fields as any[]) || [];
        });
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
          await tx.tenant.create({ data: { id: tenantId, slug: 'directorio-' + tenantId, subscriptionStatus: 'ACTIVE' } });
          await tx.app.create({ data: { id: appId, tenantId, name: primaryDivisionName, bundleId: 'com.aliados.d' + appId.replaceAll('-', '') } });
          const schema = await createForm(tx, tenantId, appId, templateFields as any, 1);
          const network = await tx.affiliateNetwork.create({ data: {
            id: networkId, tenantId, appId, name: primaryDivisionName, fields: templateFields as any,
            schemaId: schema.id, approvalStatus: 'APPROVED', platformRoot: true,
          }});
          const root = await tx.affiliateMember.create({ data: {
            id: memberId, tenantId, networkId, name: adminName, email: adminEmail,
            password, role: 'ROOT', data: {},
          }});
          await mirrorMember(tx, network, root);
          await tx.platformDirectory.create({ data: {
            tenantId, rootAppId: appId, name, slogan, divisionLabel,
            primaryColor, secondaryColor, accentColor, backgroundColor,
            directoryAdminName: adminName, directoryAdminEmail: adminEmail,
            createdBy: administrator.id,
          }});
          await tx.platformAuditLog.create({ data: {
            administratorId: administrator.id, action: 'directory.created', directoryId: tenantId,
            details: { name, slogan, divisionLabel, primaryDivisionName, directoryAdminEmail: adminEmail, primaryColor, secondaryColor, accentColor, backgroundColor },
          }});
        }, { timeout: 30_000 });
        return send({ ok: true, id: tenantId }, 201);
      }
      const editMatch = path.match(/^\/directories\/([^/]+)$/);
      if (editMatch && method === 'PUT') {
        if (!uuidPattern.test(editMatch[1])) fail(400, 'Directorio inválido.');
        const directory = await prisma.platformDirectory.findUnique({ where: { id: editMatch[1] } });
        if (!directory) fail(404, 'Directorio no disponible.');
        const body = await requestBody(req);
        const name = cleanText(body.name, 'El nombre del directorio');
        const slogan = cleanText(body.slogan, 'El eslogan', 200);
        const divisionLabel = cleanText(body.divisionLabel, 'El nombre de las divisiones', 80);
        const primaryColor = cleanColor(body.primaryColor, 'El color principal');
        const secondaryColor = cleanColor(body.secondaryColor, 'El color secundario');
        const accentColor = cleanColor(body.accentColor, 'El color de acento');
        const backgroundColor = cleanColor(body.backgroundColor, 'El color de fondo');
        const primaryDivisionName = cleanText(body.primaryDivisionName, 'El nombre de la división principal');
        const adminName = cleanText(body.adminName, 'El nombre del superadministrador');
        const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
        if (!emailPattern.test(adminEmail) || adminEmail.length > 254) fail(400, 'El correo del superadministrador no es válido.');
        if (body.adminPassword !== undefined && typeof body.adminPassword !== 'string') fail(400, 'La contraseña no es válida.');
        const password = body.adminPassword ? await passwordHash(body.adminPassword) : undefined;
        const targetDirectory = directory!;
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${targetDirectory.tenantId},true)`;
          const network = await tx.affiliateNetwork.findUniqueOrThrow({ where: { appId: targetDirectory.rootAppId } });
          const root = await tx.affiliateMember.findFirstOrThrow({ where: {
            tenantId: targetDirectory.tenantId, networkId: network.id, role: 'ROOT', parentId: null,
          }});
          await tx.app.update({ where: { tenantId_id: { tenantId: targetDirectory.tenantId, id: targetDirectory.rootAppId } }, data: { name: primaryDivisionName } });
          const updatedNetwork = await tx.affiliateNetwork.update({ where: { id: network.id }, data: { name: primaryDivisionName } });
          const credentialsChanged = root.email !== adminEmail || !!password;
          const updatedRoot = await tx.affiliateMember.update({ where: { id: root.id }, data: {
            name: adminName, email: adminEmail, ...(password ? { password } : {}),
          }});
          await mirrorMember(tx, updatedNetwork, updatedRoot);
          if (credentialsChanged) await tx.affiliateSession.deleteMany({ where: {
            tenantId: targetDirectory.tenantId, networkId: network.id, memberId: root.id,
          }});
          await tx.platformDirectory.update({ where: { id: targetDirectory.id }, data: {
            name, slogan, divisionLabel, primaryColor, secondaryColor, accentColor, backgroundColor,
            directoryAdminName: adminName, directoryAdminEmail: adminEmail,
          }});
          await tx.platformAuditLog.create({ data: {
            administratorId: administrator.id, action: 'directory.updated', directoryId: targetDirectory.id,
            details: { name, slogan, divisionLabel, primaryDivisionName, directoryAdminEmail: adminEmail, primaryColor, secondaryColor, accentColor, backgroundColor, passwordChanged: !!password },
          }});
        }, { timeout: 30_000 });
        return send({ ok: true });
      }
      const stateMatch = path.match(/^\/directories\/([^/]+)\/state$/);
      if (stateMatch && method === 'PUT') {
        if (!uuidPattern.test(stateMatch[1])) fail(400, 'Directorio inválido.');
        const body = await requestBody(req), status = body.status;
        if (!['ACTIVE', 'ARCHIVED'].includes(status)) fail(400, 'Estado inválido.');
        const directory = await prisma.platformDirectory.update({ where: { id: stateMatch[1] }, data: {
          status, archivedAt: status === 'ARCHIVED' ? new Date() : null,
        }});
        if (status === 'ARCHIVED') await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${directory.tenantId},true)`;
          await tx.affiliateSession.deleteMany({ where: { tenantId: directory.tenantId } });
        });
        await prisma.platformAuditLog.create({ data: {
          administratorId: administrator.id, action: status === 'ARCHIVED' ? 'directory.archived' : 'directory.reactivated',
          directoryId: directory.id, details: { name: directory.name },
        }});
        return send({ ok: true });
      }
      const enterMatch = path.match(/^\/directories\/([^/]+)\/enter$/);
      if (enterMatch && method === 'POST') {
        if (!uuidPattern.test(enterMatch[1])) fail(400, 'Directorio inválido.');
        const directory = await prisma.platformDirectory.findUnique({ where: { id: enterMatch[1] } });
        if (!directory) fail(404, 'Directorio no disponible.');
        const targetDirectory = directory!;
        if (targetDirectory.status !== 'ACTIVE') fail(409, 'El directorio debe estar activo para ingresar.');
        const affiliateToken = randomBytes(32).toString('hex'), affiliateCsrf = randomBytes(24).toString('hex');
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${targetDirectory.tenantId},true)`;
          const network = await tx.affiliateNetwork.findUniqueOrThrow({ where: { appId: targetDirectory.rootAppId } });
          const root = await tx.affiliateMember.findFirstOrThrow({ where: { tenantId: targetDirectory.tenantId, networkId: network.id, role: 'ROOT', parentId: null, status: 'active' } });
          await tx.affiliateSession.create({ data: {
            token: digest(affiliateToken), tenantId: targetDirectory.tenantId, networkId: network.id,
            memberId: root.id, csrf: affiliateCsrf, expires: BigInt(Date.now() + 8 * 60 * 60_000),
            platformAdminId: administrator.id,
          }});
          await tx.auditLog.create({ data: {
            tenantId: targetDirectory.tenantId, actor: 'platform-admin:' + administrator.id,
            action: 'directory.entered', resourceId: targetDirectory.id, details: { directoryName: targetDirectory.name },
          }});
        });
        const scopedPath = `/affiliates/${targetDirectory.tenantId}/${targetDirectory.rootAppId}/`;
        res.setHeader('Set-Cookie', `af_${targetDirectory.rootAppId}=${affiliateToken}; HttpOnly; SameSite=Lax; Path=${scopedPath}; Max-Age=28800; Secure`);
        return send({ ok: true, url: scopedPath });
      }
      const deleteMatch = path.match(/^\/directories\/([^/]+)$/);
      if (deleteMatch && method === 'DELETE') {
        if (!uuidPattern.test(deleteMatch[1])) fail(400, 'Directorio inválido.');
        const body = await requestBody(req);
        if (body.confirmation !== 'borrar directorio') fail(400, 'Escribe exactamente “borrar directorio” para continuar.');
        const directory = await prisma.platformDirectory.findUnique({ where: { id: deleteMatch[1] } });
        if (!directory) fail(404, 'Directorio no disponible.');
        const targetDirectory = directory!;
        const details = { name: targetDirectory.name, tenantId: targetDirectory.tenantId, rootAppId: targetDirectory.rootAppId };
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id',${targetDirectory.tenantId},true)`;
          await tx.platformAuditLog.create({ data: {
            administratorId: administrator.id, action: 'directory.deleted', directoryId: targetDirectory.id, details,
          }});
          await tx.tenant.delete({ where: { id: targetDirectory.tenantId } });
        }, { timeout: 30_000 });
        return send({ ok: true });
      }
      if (path === '/logout' && method === 'POST') {
        await prisma.platformAdminSession.delete({ where: { tokenDigest: activeSession.tokenDigest } }).catch(() => undefined);
        res.setHeader('Set-Cookie', 'platform_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure');
        return send({ ok: true });
      }
      fail(404, 'Ruta global no disponible.');
    } catch (error: any) {
      if (res.headersSent) return;
      const conflict = error?.code === 'P2002';
      send({ error: conflict ? 'Ya existe un registro con esos datos.' : error?.status ? error.message : 'No se pudo completar la operación.' }, conflict ? 409 : error?.status || 500);
      if (!error?.status && !conflict) console.error('Platform directory request failed:', error?.name || error);
    }
  };
}
