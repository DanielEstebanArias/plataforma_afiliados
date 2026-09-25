import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AffiliatesStore } from './store';
import { createForm, mirrorMember } from './store';
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
        superuser: me.role === 'ROOT' && n.platformRoot,
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
        communities: rows.map((c) => ({
          ...c,
          hasPhoto: !!images.get(c.id),
          current: c.id === n.id,
          canEditPhoto:
            superuser || c.requestedBy === me.id || (c.id === n.id && me.role === 'ROOT'),
          url: `/affiliates/${n.tenantId}/${c.appId}/`,
        })),
      };
    });
  }
  async requestCommunity(me: any, b: any) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 150)
      fail(400, 'Escribe el nombre de la comunidad (máximo 150 caracteres).');
    const image = b.base64 ? photo(b.base64) : {};
    return this.store.tx(async (tx, n) => {
      const id = randomUUID(),
        appId = randomUUID(),
        rootId = randomUUID();
      const owner = await tx.affiliateMember.findUniqueOrThrow({ where: { id: me.id } });
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
          requestedBy: me.id,
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
          name: owner.name,
          email: owner.email,
          password: owner.password,
          role: 'ROOT',
          data: owner.data as any,
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
        actor: 'affiliate:' + actor,
        action,
        resourceId,
        details,
      },
    });
  }
}
