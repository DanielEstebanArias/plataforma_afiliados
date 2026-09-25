import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { FieldSchema } from '../contracts/app-config.schema';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NetworkFeatures } from './features';

type Field = { id: string; label: string; type: string; required: boolean; options?: string[] };
export const column = (id: string) =>
  'custom_' + createHash('sha256').update(id).digest('hex').slice(0, 16);
export function coreFields(fields: Field[]) {
  return [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'parent_id', type: 'text', required: false },
    { name: 'status', type: 'text', required: true },
    ...fields.map((f) => ({
      name: column(f.id),
      type:
        (
          { checkbox: 'boolean', number: 'number', date: 'date', email: 'email' } as Record<
            string,
            string
          >
        )[f.type] || 'text',
      required: false,
      ...(f.type === 'select' ? { options: f.options } : {}),
    })),
  ].map((f) => FieldSchema.parse(f));
}
export async function createForm(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appId: string,
  fields: Field[],
  version: number,
) {
  return tx.dynamicSchema.create({
    data: { tenantId, appId, name: 'affiliates_v' + version, version, fields: coreFields(fields) },
  });
}
export async function mirrorMember(tx: Prisma.TransactionClient, network: any, m: any) {
  const data: Record<string, any> = { name: m.name, email: m.email, status: m.status };
  if (m.parentId) data.parent_id = m.parentId;
  for (const f of network.fields as Field[]) {
    const v = m.data[f.id];
    if (v === undefined || v === null || v === '') continue;
    data[column(f.id)] = f.type === 'number' ? Number(v) : v;
  }
  const key = { tenantId: network.tenantId, schemaId: network.schemaId, idempotencyKey: m.id };
  await tx.dynamicRecord.upsert({
    where: { tenantId_schemaId_idempotencyKey: key },
    create: { ...key, data },
    update: { data },
  });
}
const memberRow = (m: any) =>
  m && {
    id: m.id,
    parent_id: m.parentId,
    name: m.name,
    email: m.email,
    password: m.password,
    role: m.role,
    status: m.status,
    data: JSON.stringify(m.data),
    photo: m.photo && Buffer.from(m.photo),
    mime: m.mime,
    created: m.createdAt.toISOString(),
  };
/** Compatibility boundary for the existing member API; all production operations use Prisma/RLS. */
export class AffiliatesStore {
  readonly features = new NetworkFeatures(this);
  async visible(viewer:string,target:string){return memberRow(await this.features.visible(viewer,target));}
  readonly integrated = true;
  private requestContext = new AsyncLocalStorage<{ actor: string }>();
  private get actor() {
    return this.requestContext.getStore()?.actor || 'affiliate-service';
  }
  request<T>(fn: () => T): T {
    return this.requestContext.run({ actor: 'anonymous' }, fn);
  }
  setActor(id: string) {
    const scope = this.requestContext.getStore();
    if (scope) scope.actor = 'affiliate:' + id;
  }
  constructor(
    readonly prisma: PrismaClient,
    readonly tenantId: string,
    readonly appId: string,
  ) {}
  async tx<T>(fn: (tx: Prisma.TransactionClient, n: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${this.tenantId},true)`;
        const n = await tx.affiliateNetwork.findUniqueOrThrow({
          where: { tenantId_appId: { tenantId: this.tenantId, appId: this.appId } },
        });
        return fn(tx, n);
      },
      { timeout: 15000 },
    );
  }
  async catalog() {
    return this.tx(async (tx, n) => ({
      app: await tx.app.findUniqueOrThrow({ where: { id: n.appId } }),
      formVersion: n.formVersion,
      schemas: await tx.dynamicSchema.findMany({
        where: { appId: n.appId },
        orderBy: { version: 'desc' },
      }),
      members: await tx.affiliateMember.count({ where: { networkId: n.id } }),
      storage: 'PostgreSQL · Prisma · SuperApp',
    }));
  }
  prepare(sql: string) {
    return {
      get: (...p: any[]) => this.query(sql, p),
      all: (...p: any[]) => this.query(sql, p),
      run: (...p: any[]) => this.query(sql, p),
    };
  }
  async query(sql: string, p: any[]): Promise<any> {
    const q = sql.replace(/\s+/g, ' ').trim();
    return this.tx(async (tx, n) => {
      const scope = { tenantId: this.tenantId, networkId: n.id };
      if (q === 'SELECT * FROM organization WHERE id=1')
        return {
          id: 1,
          name: n.name,
          fields: JSON.stringify(n.fields),
          integration: {
            appId: n.appId,
            tenantId: n.tenantId,
            formVersion: n.formVersion,
            storage: 'PostgreSQL',
          },
        };
      if (q === 'SELECT * FROM members WHERE id=?')
        return memberRow(await tx.affiliateMember.findFirst({ where: { ...scope, id: p[0] } }));
      if (q === 'SELECT * FROM members WHERE email=?')
        return memberRow(await tx.affiliateMember.findFirst({ where: { ...scope, email: p[0] } }));
      if (q.startsWith('WITH RECURSIVE tree')) {
        const rows = await tx.$queryRaw<
          any[]
        >`WITH RECURSIVE tree AS (SELECT * FROM "AffiliateMember" WHERE id=${p[0]}::uuid AND "networkId"=${n.id}::uuid UNION ALL SELECT m.* FROM "AffiliateMember" m JOIN tree t ON m."parentId"=t.id WHERE m."networkId"=${n.id}::uuid) SELECT * FROM tree ORDER BY "createdAt",id`;
        return rows.map(memberRow);
      }
      if (q === 'SELECT * FROM sessions WHERE token=? AND expires>?') {
        const s = await tx.affiliateSession.findFirst({
          where: { ...scope, token: p[0], expires: { gt: BigInt(p[1]) } },
        });
        return (
          s && { token: s.token, member_id: s.memberId, csrf: s.csrf, expires: Number(s.expires) }
        );
      }
      if (q === 'INSERT INTO sessions VALUES(?,?,?,?)')
        return tx.affiliateSession.create({
          data: { ...scope, token: p[0], memberId: p[1], csrf: p[2], expires: BigInt(p[3]) },
        });
      if (q === 'DELETE FROM sessions WHERE expires<?')
        return tx.affiliateSession.deleteMany({
          where: { ...scope, expires: { lt: BigInt(p[0]) } },
        });
      if (q === 'DELETE FROM sessions WHERE token=?')
        return tx.affiliateSession.deleteMany({ where: { ...scope, token: p[0] } });
      if (q === 'DELETE FROM sessions WHERE member_id=?')
        return tx.affiliateSession.deleteMany({ where: { ...scope, memberId: p[0] } });
      if (q === 'UPDATE organization SET fields=? WHERE id=1') {
        // Serialize schema revisions so simultaneous root edits never overwrite a revision.
        await tx.$queryRaw`SELECT id FROM "AffiliateNetwork" WHERE id=${n.id}::uuid FOR UPDATE`;
        const current = await tx.affiliateNetwork.findUniqueOrThrow({ where: { id: n.id } });
        const fields = JSON.parse(p[0]),
          version = current.formVersion + 1;
        const schema = await createForm(tx, this.tenantId, this.appId, fields, version);
        await tx.affiliateNetwork.update({
          where: { id: n.id },
          data: { fields, schemaId: schema.id, formVersion: version },
        });
        await tx.app.update({ where: { id: this.appId }, data: { revision: { increment: 1 } } });
        await tx.auditLog.create({
          data: {
            tenantId: this.tenantId,
            actor: this.actor,
            action: 'affiliates.form.updated',
            resourceId: schema.id,
            details: { appId: this.appId, version },
          },
        });
        return {};
      }
      let m: any;
      if (q.startsWith('INSERT INTO members(') && q.includes("'MEMBER'")) {
        m = await tx.affiliateMember.create({
          data: {
            ...scope,
            id: p[0],
            parentId: p[1],
            name: p[2],
            email: p[3],
            password: p[4],
            role: 'MEMBER',
            data: JSON.parse(p[5]),
            createdAt: new Date(p[6]),
          },
        });
      } else if (q === 'UPDATE members SET name=?,email=?,data=?,status=? WHERE id=?') {
        m = await tx.affiliateMember.update({
          where: { tenantId_networkId_id: { ...scope, id: p[4] } },
          data: { name: p[0], email: p[1], data: JSON.parse(p[2]), status: p[3] },
        });
      } else if (q === 'UPDATE members SET photo=?,mime=? WHERE id=?') {
        m = await tx.affiliateMember.update({
          where: { tenantId_networkId_id: { ...scope, id: p[2] } },
          data: { photo: p[0], mime: p[1] },
        });
      } else if (q === 'UPDATE members SET password=? WHERE id=?') {
        m = await tx.affiliateMember.update({
          where: { tenantId_networkId_id: { ...scope, id: p[1] } },
          data: { password: p[0] },
        });
      } else throw new Error('Unsupported affiliates operation');
      await mirrorMember(tx, n, m);
      await tx.auditLog.create({
        data: {
          tenantId: this.tenantId,
          actor: this.actor,
          action: q.startsWith('INSERT')
            ? 'affiliates.member.created'
            : 'affiliates.member.updated',
          resourceId: m.id,
          details: { appId: this.appId },
        },
      });
      return {};
    });
  }
}
