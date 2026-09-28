import { Prisma } from '@prisma/client';
import { randomUUID, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const hashPassword = promisify(scrypt);
const defaultModules = { access: true, dashboard: true, form: true, createCommunities: false };
function parseModules(value: any) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !(key in defaultModules)) ||
    ['access', 'dashboard', 'form'].some((key) => typeof value[key] !== 'boolean') ||
    (value.createCommunities !== undefined && typeof value.createCommunities !== 'boolean')
  )
    fail(400, 'Selecciona los submódulos de la comunidad.');
  return {
    access: value.access,
    dashboard: value.dashboard,
    form: value.form,
    createCommunities: value.createCommunities ?? false,
  };
}
function requireModule(n: any, key: keyof typeof defaultModules) {
  if (!n.platformRoot && n.modules?.[key] === false)
    fail(403, 'Este submódulo no está habilitado para la comunidad.');
}
import type { AffiliatesStore } from './store';
import { createForm, mirrorMember } from './store';
import { csvLine, exportColumns } from './csv';
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
const uuid = (s: any) => {
  if (typeof s !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s))
    fail(400, 'Identificador inválido.');
  return s;
};
const clean = (m: any) => ({
  id: m.id,
  parentId: m.parentId,
  name: m.name,
  email: m.email,
  role: m.role,
  status: m.status,
  data: m.data,
  hasPhoto: m.hasPhoto ?? !!m.photo,
  created: m.createdAt,
  childCount: Number(m.childCount || 0),
});
const selection = Prisma.sql`m.id,m."parentId",m.name,m.email,m.role,m.status,m.data,m."createdAt",(m.photo IS NOT NULL) AS "hasPhoto",(SELECT count(*)::int FROM "AffiliateMember" c WHERE c."networkId"=m."networkId" AND c."parentId"=m.id) AS "childCount"`;
const tree = (network: string, root: string) =>
  Prisma.sql`WITH tree AS (SELECT *,level-(SELECT level FROM "AffiliateMember" WHERE id=${root}::uuid) AS depth FROM "AffiliateMember" WHERE "networkId"=${network}::uuid AND (id=${root}::uuid OR ancestry @> ARRAY[${root}::uuid]))`;
async function depth(tx: Prisma.TransactionClient, n: any, id: string) {
  const rows = await tx.$queryRaw<
    any[]
  >`SELECT level FROM "AffiliateMember" WHERE id=${uuid(id)}::uuid AND "networkId"=${n.id}::uuid`;
  if (!rows.length) fail(404, 'Afiliado no disponible.');
  return Number(rows[0].level);
}
async function visible(tx: Prisma.TransactionClient, n: any, viewer: string, target: string) {
  const rows = await tx.$queryRaw<
    any[]
  >`SELECT id FROM "AffiliateMember" WHERE id=${uuid(target)}::uuid AND "networkId"=${n.id}::uuid AND (id=${viewer}::uuid OR ancestry @> ARRAY[${viewer}::uuid])`;
  if (!rows.length) fail(404, 'Afiliado no disponible.');
}
function photo(base64: any) {
  if (typeof base64 !== 'string') fail(400, 'Selecciona una imagen.');
  const b = Buffer.from(base64, 'base64');
  const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (b.length < 12 || b.length > 2000000 || (!png && !jpeg))
    fail(400, 'Usa JPG o PNG, máximo 2 MB.');
  return { photo: b, photoMime: png ? 'image/png' : 'image/jpeg' };
}
export class NetworkFeatures {
  constructor(private store: AffiliatesStore) {}
  async exportCommunities(me: any, write: (chunk: string) => Promise<void>) {
    return this.store.tx(
      async (tx, n) => {
        if (!n.platformRoot || me.role !== 'ROOT' || this.store.isCommunityAdmin)
          fail(403, 'Solo el superadministrador exporta todas las comunidades.');
        const networks = await tx.affiliateNetwork.findMany({
          where: { tenantId: n.tenantId },
          select: { id: true, name: true, fields: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
        // Include stored values from fields removed from a community's current form.
        const savedKeys = await tx.$queryRaw<{ networkId: string; key: string }[]>`
        SELECT DISTINCT "networkId", jsonb_object_keys(data) AS key FROM "AffiliateMember" WHERE "tenantId"=${n.tenantId}::uuid`;
        const definitions = networks.map((network) => {
          const fields = [...(network.fields as any[])];
          for (const row of savedKeys
            .filter((row) => row.networkId === network.id)
            .sort((a, b) => a.key.localeCompare(b.key)))
            if (!fields.some((f) => f.id === row.key))
              fields.push({ id: row.key, label: row.key, type: 'campo anterior' });
          return { ...network, fields };
        });
        const { columns, mappings } = exportColumns(definitions);
        await write(
          '\ufeff' +
            csvLine([
              'Comunidad',
              'ID comunidad',
              'ID afiliado',
              'Nombre',
              'Correo',
              'ID superior',
              'Superior',
              'Rol',
              'Estado',
              'Fecha de registro',
              'Tiene foto',
              ...columns.map((c) => c.label),
            ]),
        );
        let records = 0;
        for (const network of definitions) {
          const mapping = mappings.get(network.id)!;
          let cursor: string | undefined;
          while (true) {
            const members = await tx.affiliateMember.findMany({
              where: {
                tenantId: n.tenantId,
                networkId: network.id,
                ...(cursor ? { id: { gt: cursor } } : {}),
              },
              select: {
                id: true,
                name: true,
                email: true,
                parentId: true,
                parent: { select: { name: true } },
                role: true,
                status: true,
                createdAt: true,
                data: true,
              },
              orderBy: { id: 'asc' },
              take: 1000,
            });
            if (!members.length) break;
            const photos = await tx.$queryRaw<{ id: string; present: boolean }[]>(
              Prisma.sql`SELECT id, (photo IS NOT NULL) AS present FROM "AffiliateMember" WHERE "tenantId"=${n.tenantId}::uuid AND id::text IN (${Prisma.join(members.map((m) => m.id))})`,
            );
            const hasPhoto = new Map(photos.map((p) => [p.id, p.present]));
            await write(
              members
                .map((m) =>
                  csvLine([
                    network.name,
                    network.id,
                    m.id,
                    m.name,
                    m.email,
                    m.parentId,
                    m.parent?.name,
                    m.role,
                    m.status,
                    m.createdAt.toISOString(),
                    hasPhoto.get(m.id) ? 'Sí' : 'No',
                    ...columns.map((_, index) =>
                      mapping.has(index) ? ((m.data as any)[mapping.get(index)!] ?? '') : '',
                    ),
                  ]),
                )
                .join(''),
            );
            records += members.length;
            cursor = members.at(-1)!.id;
          }
        }
        await this.audit(tx, me.id, 'communities.exported', n.id, {
          communities: networks.length,
          records,
        });
      },
      { timeout: 120000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async requireModule(key: keyof typeof defaultModules) {
    if (this.store.isCommunityAdmin) return;
    return this.store.tx(async (_tx, n) => requireModule(n, key));
  }
  async communityTree(
    me: any,
    id: string,
    params: URLSearchParams,
    memberId?: string,
    withPhoto = false,
  ) {
    return this.store.tx(async (tx, n) => {
      if (!n.platformRoot || me.role !== 'ROOT')
        fail(403, 'Solo el superadministrador consulta árboles de otras comunidades.');
      const target = await tx.affiliateNetwork.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId },
      });
      if (!target) fail(404, 'Comunidad no disponible.');
      const root = await tx.affiliateMember.findFirst({
        where: { networkId: target.id, tenantId: n.tenantId, role: 'ROOT', parentId: null },
      });
      if (!root) fail(404, 'La comunidad no tiene una cuenta raíz.');
      const features = new NetworkFeatures({ tx: (fn: any) => fn(tx, target) } as AffiliatesStore);
      if (memberId) {
        const member = await features.visible(root.id, memberId);
        if (withPhoto) {
          if (!member.photo) fail(404, 'El afiliado no tiene foto.');
          return { bytes: member.photo, mime: member.mime };
        }
        return { member: clean(member) };
      }
      const page = await features.page(root.id, params);
      return {
        ...page,
        root: clean(root),
        organization: { name: target.name, fields: target.fields },
        stats: await features.stats(root.id),
      };
    });
  }
  async updateModules(me: any, id: string, b: any) {
    return this.store.tx(async (tx, n) => {
      if (!n.platformRoot || me.role !== 'ROOT')
        fail(403, 'Solo el superadministrador habilita submódulos.');
      const target = await tx.affiliateNetwork.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId },
      });
      if (!target || target.platformRoot)
        fail(403, 'Comunidad no disponible para configurar submódulos.');
      const modules = parseModules(b.modules);
      await tx.affiliateNetwork.update({ where: { id }, data: { modules } });
      await this.audit(tx, me.id, 'community.modules.updated', id, { modules });
      return { modules };
    });
  }
  async access(id: string) {
    return this.store.tx(async (tx, n) => {
      if (n.approvalStatus !== 'APPROVED')
        fail(
          403,
          n.approvalStatus === 'PENDING'
            ? 'La comunidad está pendiente de aprobación.'
            : 'La comunidad no está habilitada.',
        );
      const level = await depth(tx, n, id);
      if (n.maxLoginLevel !== null && level > n.maxLoginLevel)
        fail(403, 'Tu afiliación está registrada, pero tu nivel no tiene acceso a la app.');
      return { level, maxLoginLevel: n.maxLoginLevel, superuser: n.platformRoot };
    });
  }
  async changeRoot(me: any, id: string, b: any) {
    try {
      return await this.store.tx(async (tx, n) => {
        if (!n.platformRoot || me.role !== 'ROOT')
          fail(403, 'Solo el superadministrador cambia el usuario raíz.');
        const target = await tx.affiliateNetwork.findFirst({
          where: { id: uuid(id), tenantId: n.tenantId },
        });
        if (!target || target.platformRoot)
          fail(403, 'Comunidad no disponible para cambiar su raíz.');
        const input = b?.root;
        if (
          !input ||
          typeof input.name !== 'string' ||
          !input.name.trim() ||
          input.name.length > 150 ||
          typeof input.email !== 'string' ||
          input.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
        )
          fail(400, 'Indica nombre y correo válidos para el usuario raíz.');
        if (
          typeof input.password !== 'string' ||
          input.password.length < 10 ||
          input.password.length > 200
        )
          fail(400, 'La nueva contraseña debe tener entre 10 y 200 caracteres.');
        const root = await tx.affiliateMember.findFirst({
          where: { tenantId: n.tenantId, networkId: target.id, role: 'ROOT', parentId: null },
        });
        if (!root) fail(404, 'No se encontró el usuario raíz de esta comunidad.');
        const email = input.email.trim().toLowerCase();
        const duplicate = await tx.affiliateMember.findFirst({
          where: { tenantId: n.tenantId, networkId: target.id, email, id: { not: root.id } },
          select: { id: true },
        });
        if (duplicate) fail(409, 'Ese correo ya pertenece a otro afiliado de la comunidad.');
        const salt = randomBytes(16).toString('hex');
        const password =
          salt + ':' + ((await hashPassword(input.password, salt, 64)) as Buffer).toString('hex');
        const updated = await tx.affiliateMember.update({
          where: { id: root.id },
          data: { name: input.name.trim(), email, password, status: 'active' },
        });
        await mirrorMember(tx, target, updated);
        await tx.affiliateSession.deleteMany({
          where: { networkId: target.id, memberId: root.id },
        });
        await this.audit(tx, me.id, 'community.root.changed', target.id, {
          memberId: root.id,
          previousEmail: root.email,
          email,
        });
        return { root: { id: updated.id, name: updated.name, email: updated.email } };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        fail(409, 'Ese correo ya pertenece a otro afiliado de la comunidad.');
      throw error;
    }
  }
  async registration(parent: string) {
    return this.store.tx(async (tx, n) => ({
      loginAllowed: n.maxLoginLevel === null || (await depth(tx, n, parent)) + 1 <= n.maxLoginLevel,
    }));
  }
  async visible(viewer: string, target: string) {
    return this.store.tx(async (tx, n) => {
      await visible(tx, n, viewer, target);
      return tx.affiliateMember.findFirstOrThrow({ where: { id: target, networkId: n.id } });
    });
  }
  async detail(viewer: string, target: string) {
    return clean(await this.visible(viewer, target));
  }
  async stats(viewer: string) {
    return this.store.tx(async (tx, n) => {
      const r = await tx.$queryRaw<any[]>(
        Prisma.sql`${tree(n.id, viewer)} SELECT count(*)::int AS total,count(*) FILTER(WHERE m.status='active')::int AS active,count(*) FILTER(WHERE m."parentId"=${viewer}::uuid)::int AS direct,coalesce(max(m.depth),0)::int AS levels FROM tree m`,
      );
      return r[0];
    });
  }
  async page(viewer: string, params: URLSearchParams) {
    return this.store.tx(async (tx, n) => {
      const size = Number(params.get('limit') || 50);
      if (!Number.isInteger(size) || size < 1 || size > 100)
        fail(400, 'El tamaño de página debe estar entre 1 y 100.');
      const cursor = params.get('after');
      if (cursor) uuid(cursor);
      const parent = params.get('parentId');
      if (parent) await visible(tx, n, viewer, parent);
      const q = (params.get('q') || '').trim().slice(0, 200);
      const filter = Prisma.sql`${parent ? Prisma.sql`AND m."parentId"=${parent}::uuid` : Prisma.empty} ${q ? Prisma.sql`AND (m.name ILIKE ${'%' + q + '%'} OR m.email ILIKE ${'%' + q + '%'} OR m.data::text ILIKE ${'%' + q + '%'})` : Prisma.empty}`;
      const cte = parent
        ? Prisma.sql`WITH tree AS (SELECT * FROM "AffiliateMember" WHERE "networkId"=${n.id}::uuid AND "parentId"=${parent}::uuid)`
        : tree(n.id, viewer);
      const rows = await tx.$queryRaw<any[]>(
        Prisma.sql`${cte}, page AS MATERIALIZED (SELECT m.id,m."parentId",m.name,m.email,m.role,m.status,m.data,m."createdAt",m.photo,m."networkId" FROM tree m WHERE m."networkId"=${n.id}::uuid ${filter} ${cursor ? Prisma.sql`AND m.id>${cursor}::uuid` : Prisma.empty} ORDER BY m.id LIMIT ${size + 1}) SELECT ${selection} FROM page m ORDER BY m.id`,
      );
      const count = await tx.$queryRaw<any[]>(
        Prisma.sql`${cte} SELECT count(*)::int AS count FROM tree m WHERE m."networkId"=${n.id}::uuid ${filter}`,
      );
      const nextCursor = rows.length > size ? rows[size - 1].id : null;
      return {
        members: rows
          .slice(0, size)
          .map((m) => ({ ...clean(m), parentId: m.id === viewer ? null : m.parentId })),
        total: count[0].count,
        nextCursor,
        limit: size,
      };
    });
  }
  async settings(me: any, b?: any) {
    return this.store.tx(async (tx, n) => {
      if (b !== undefined) {
        if (!this.store.isCommunityAdmin) requireModule(n, 'access');
        if (me.role !== 'ROOT') fail(403, 'Solo la raíz configura el acceso.');
        const limit = b.maxLoginLevel;
        if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10000))
          fail(400, 'Usa un nivel entero desde 0 o sin límite.');
        await tx.affiliateNetwork.update({ where: { id: n.id }, data: { maxLoginLevel: limit } });
        await this.audit(tx, me.id, 'community.access.updated', n.id, { maxLoginLevel: limit });
        n.maxLoginLevel = limit;
      }
      return {
        id: n.id,
        name: n.name,
        status: n.approvalStatus,
        maxLoginLevel: n.maxLoginLevel,
        modules: n.platformRoot
          ? { ...defaultModules, createCommunities: true }
          : { ...defaultModules, ...n.modules },
        superuser: this.store.isCommunityAdmin || (me.role === 'ROOT' && n.platformRoot),
        hasPhoto: !!n.photo,
      };
    });
  }
  async communities(me: any) {
    return this.store.tx(async (tx, n) => {
      const superuser = n.platformRoot && me.role === 'ROOT';
      const rows = await tx.affiliateNetwork.findMany({
        where: {
          tenantId: n.tenantId,
          ...(superuser ? {} : { OR: [{ id: n.id }, { requestedBy: me.id }] }),
        },
        select: {
          id: true,
          appId: true,
          name: true,
          approvalStatus: true,
          reviewNote: true,
          maxLoginLevel: true,
          requestedBy: true,
          modules: true,
          platformRoot: true,
          ...(superuser
            ? {
                members: {
                  where: { role: 'ROOT', parentId: null },
                  select: { id: true, name: true, email: true },
                  take: 1,
                },
              }
            : {}),
          reviewedAt: true,
        },
        orderBy: { name: 'asc' },
        take: 500,
      });
      const photos = rows.length
        ? await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT id,(photo IS NOT NULL) AS present FROM "AffiliateNetwork" WHERE id::text IN (${Prisma.join(rows.map((c) => c.id))})`,
          )
        : [];
      const images = new Map(photos.map((p) => [p.id, p.present]));
      return {
        superuser,
        canCreate:
          me.role === 'ROOT' && (superuser || (n.modules as any)?.createCommunities === true),
        communities: rows.map(({ members, ...c }) => ({
          ...c,
          ...(superuser ? { root: members?.[0] ?? null } : {}),
          hasPhoto: !!images.get(c.id),
          current: c.id === n.id,
          canEditPhoto:
            superuser ||
            ((c.modules as any)?.access !== false &&
              (c.requestedBy === me.id || (c.id === n.id && me.role === 'ROOT'))),
          url: `/affiliates/${n.tenantId}/${c.appId}/`,
        })),
      };
    });
  }
  async requestCommunity(me: any, b: any) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 150)
      fail(400, 'Escribe el nombre de la comunidad (máximo 150 caracteres).');
    const rootInput = b.root;
    if (
      !rootInput ||
      typeof rootInput.name !== 'string' ||
      !rootInput.name.trim() ||
      rootInput.name.length > 150 ||
      typeof rootInput.email !== 'string' ||
      rootInput.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rootInput.email.trim())
    )
      fail(400, 'Indica nombre y correo válidos para el usuario raíz.');
    if (
      typeof rootInput.password !== 'string' ||
      rootInput.password.length < 10 ||
      rootInput.password.length > 200
    )
      fail(400, 'La contraseña debe tener entre 10 y 200 caracteres.');
    const modules = parseModules(b.modules);
    const salt = randomBytes(16).toString('hex');
    const password =
      salt + ':' + ((await hashPassword(rootInput.password, salt, 64)) as Buffer).toString('hex');
    const image = b.base64 ? photo(b.base64) : {};
    return this.store.tx(async (tx, n) => {
      const id = randomUUID(),
        appId = randomUUID(),
        rootId = randomUUID();
      if (
        me.role !== 'ROOT' ||
        (!this.store.isCommunityAdmin && !n.platformRoot && n.modules?.createCommunities !== true)
      )
        fail(403, 'Tu comunidad no tiene permiso para crear comunidades.');
      if (
        !(this.store.isCommunityAdmin || (n.platformRoot && me.role === 'ROOT')) &&
        Object.values(modules).some((enabled) => enabled)
      )
        fail(403, 'Solo el superadministrador habilita submódulos.');
      await tx.app.create({
        data: {
          id: appId,
          tenantId: n.tenantId,
          name: b.name.trim(),
          bundleId: 'com.superapp.c' + id.replaceAll('-', ''),
        },
      });
      const schema = await createForm(tx, n.tenantId, appId, n.fields as any, 1);
      const network = await tx.affiliateNetwork.create({
        data: {
          id,
          appId,
          tenantId: n.tenantId,
          name: b.name.trim(),
          fields: n.fields as any,
          schemaId: schema.id,
          requestedBy: this.store.adminActorId || me.id,
          modules,
          approvalStatus: 'PENDING',
          platformRoot: false,
          ...image,
        },
      });
      const root = await tx.affiliateMember.create({
        data: {
          id: rootId,
          tenantId: n.tenantId,
          networkId: id,
          name: rootInput.name.trim(),
          email: rootInput.email.trim().toLowerCase(),
          password,
          role: 'ROOT',
          data: {},
        },
      });
      await mirrorMember(tx, network, root);
      await this.audit(tx, me.id, 'community.requested', id, {});
      return {
        id,
        status: 'PENDING',
        message: 'Solicitud enviada. El superusuario debe aprobarla antes de ingresar.',
      };
    });
  }
  async deleteCommunity(me: any, id: string, b: any) {
    return this.store.tx(async (tx, n) => {
      if (!n.platformRoot || me.role !== 'ROOT' || this.store.isCommunityAdmin)
        fail(403, 'Solo el superusuario puede eliminar comunidades.');
      uuid(id);
      await tx.$queryRaw`SELECT id FROM "AffiliateNetwork" WHERE id=${id}::uuid AND "tenantId"=${n.tenantId}::uuid FOR UPDATE`;
      const target = await tx.affiliateNetwork.findFirst({ where: { id, tenantId: n.tenantId } });
      if (!target) fail(404, 'Comunidad no disponible.');
      if (target.platformRoot || target.id === n.id)
        fail(403, 'No se puede eliminar la comunidad del superusuario.');
      if (typeof b?.confirmName !== 'string' || b.confirmName !== target.name)
        fail(400, 'Escribe el nombre exacto de la comunidad para confirmar la eliminación.');
      const members = await tx.affiliateMember.count({
        where: { networkId: id, tenantId: n.tenantId },
      });
      // Cascades remove affiliates, photos, sessions and form records atomically.
      await tx.affiliateNetwork.delete({ where: { tenantId_id: { tenantId: n.tenantId, id } } });
      await tx.app.delete({ where: { tenantId_id: { tenantId: n.tenantId, id: target.appId } } });
      await this.audit(tx, me.id, 'community.deleted', id, {
        name: target.name,
        appId: target.appId,
        members,
      });
      return { ok: true };
    });
  }
  async review(me: any, id: string, b: any) {
    return this.store.tx(async (tx, n) => {
      if (!n.platformRoot || me.role !== 'ROOT')
        fail(403, 'Solo el superusuario aprueba comunidades.');
      if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(b.status)) fail(400, 'Estado inválido.');
      const target = await tx.affiliateNetwork.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId },
      });
      if (!target || target.platformRoot)
        fail(403, 'Esta comunidad no puede modificarse desde solicitudes.');
      const note = String(b.note || '')
        .trim()
        .slice(0, 500);
      if (b.status !== 'APPROVED' && !note) fail(400, 'Indica el motivo.');
      await tx.affiliateNetwork.update({
        where: { id },
        data: {
          approvalStatus: b.status,
          reviewNote: note,
          reviewedAt: new Date(),
          reviewedBy: me.id,
        },
      });
      if (b.status !== 'APPROVED')
        await tx.affiliateSession.deleteMany({ where: { networkId: id } });
      await this.audit(tx, me.id, 'community.reviewed', id, { status: b.status, note });
      return { ok: true };
    });
  }
  async communityPhoto(me: any, id: string, base64?: string) {
    return this.store.tx(async (tx, n) => {
      const target = await tx.affiliateNetwork.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId },
      });
      if (
        !target ||
        !(
          target.id === n.id ||
          target.requestedBy === me.id ||
          (n.platformRoot && me.role === 'ROOT')
        )
      )
        fail(404, 'Comunidad no disponible.');
      if (base64 !== undefined) {
        if (!(n.platformRoot && me.role === 'ROOT')) requireModule(target, 'access');
        if (
          !(n.platformRoot && me.role === 'ROOT') &&
          !(target.id === n.id && me.role === 'ROOT') &&
          target.requestedBy !== me.id
        )
          fail(403, 'No puedes editar esta comunidad.');
        await tx.affiliateNetwork.update({ where: { id }, data: photo(base64) });
        await this.audit(tx, me.id, 'community.photo.updated', id, {});
        return { ok: true };
      }
      if (!target.photo) fail(404, 'La comunidad no tiene foto.');
      return { bytes: target.photo, mime: target.photoMime };
    });
  }
  async dashboard(me: any, b?: any, filters = new URLSearchParams()) {
    return this.store.tx(async (tx, n) => {
      if (!this.store.isCommunityAdmin) requireModule(n, 'dashboard');
      const member = await tx.affiliateMember.findUniqueOrThrow({ where: { id: me.id } });
      const fields = n.fields as any[];
      const defaults = [
        { title: 'Afiliados por estado', groupBy: '$status', metric: 'count', chart: 'donut' },
        { title: 'Registros por mes', groupBy: '$month', metric: 'count', chart: 'bar' },
      ];
      const widgets =
        b?.widgets ?? ((member.dashboard as any[]).length ? member.dashboard : defaults);
      if (!Array.isArray(widgets) || widgets.length > 12) fail(400, 'Configura hasta 12 gráficas.');
      for (const w of widgets) {
        if (
          typeof w.title !== 'string' ||
          !w.title.trim() ||
          w.title.length > 100 ||
          !['count', 'sum', 'avg'].includes(w.metric) ||
          !['bar', 'donut', 'kpi'].includes(w.chart)
        )
          fail(400, 'Configuración de gráfica inválida.');
        if (!['$status', '$month'].includes(w.groupBy) && !fields.some((f) => f.id === w.groupBy))
          fail(400, 'El campo de agrupación ya no existe en el formulario.');
        if (
          w.metric !== 'count' &&
          !fields.some((f) => f.id === w.valueField && f.type === 'number')
        )
          fail(400, 'Suma y promedio requieren un campo numérico.');
      }
      if (b !== undefined) {
        await tx.affiliateMember.update({ where: { id: me.id }, data: { dashboard: widgets } });
        await this.audit(tx, me.id, 'community.dashboard.updated', n.id, { memberId: me.id });
        return { ok: true };
      }
      const from = filters.get('from'),
        to = filters.get('to'),
        status = filters.get('status');
      for (const d of [from, to])
        if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d))))
          fail(400, 'Fecha inválida.');
      if (from && to && from > to) fail(400, 'El inicio debe ser anterior al fin.');
      if (status && !['active', 'inactive'].includes(status)) fail(400, 'Estado inválido.');
      const where = Prisma.sql`${from ? Prisma.sql`AND m."createdAt">=${new Date(from)}` : Prisma.empty} ${to ? Prisma.sql`AND m."createdAt"<${new Date(Date.parse(to) + 86400000)}` : Prisma.empty} ${status ? Prisma.sql`AND m.status=${status}` : Prisma.empty}`;
      const charts = [];
      for (const w of widgets) {
        const group =
          w.groupBy === '$status'
            ? Prisma.sql`m.status`
            : w.groupBy === '$month'
              ? Prisma.sql`to_char(m."createdAt",'YYYY-MM')`
              : Prisma.sql`coalesce(nullif(m.data->>${w.groupBy},''),'Sin datos')`;
        const value =
          w.metric === 'count'
            ? Prisma.sql`count(*)::float8`
            : w.metric === 'sum'
              ? Prisma.sql`coalesce(sum(CASE WHEN m.data->>${w.valueField} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (m.data->>${w.valueField})::numeric ELSE NULL END),0)::float8`
              : Prisma.sql`avg(CASE WHEN m.data->>${w.valueField} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (m.data->>${w.valueField})::numeric ELSE NULL END)::float8`;
        const rows = await tx.$queryRaw<any[]>(
          Prisma.sql`${tree(n.id, me.id)} SELECT ${group} AS label,${value} AS value,count(*)::int AS count FROM tree m WHERE true ${where} GROUP BY 1 ORDER BY 1 LIMIT 51`,
        );
        const total = await tx.$queryRaw<any[]>(
          Prisma.sql`${tree(n.id, me.id)} SELECT ${value} AS value,count(*)::int AS count FROM tree m WHERE true ${where}`,
        );
        charts.push({
          ...w,
          rows: rows.slice(0, 50),
          truncated: rows.length > 50,
          total: total[0].value,
          records: total[0].count,
        });
      }
      return {
        widgets,
        charts,
        scope: 'Solo tu rama autorizada',
        fields: fields.map((f) => ({ id: f.id, label: f.label, type: f.type })),
      };
    });
  }
  private audit(
    tx: Prisma.TransactionClient,
    actor: string,
    action: string,
    resourceId: string,
    details: any,
  ) {
    return tx.auditLog.create({
      data: {
        tenantId: this.store.tenantId,
        actor: 'affiliate:' + (this.store.adminActorId || actor),
        action,
        resourceId,
        details,
      },
    });
  }
}
