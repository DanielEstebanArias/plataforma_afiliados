import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { FieldSchema } from '../contracts/app-config.schema';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NetworkFeatures } from './features';
import { AffiliateTerms } from './terms';
import { AffiliateCampaigns } from './campaigns';
import { AffiliatePasswordRecovery } from './password-recovery';

type Field = { id: string; label: string; type: string; required: boolean; options?: string[] };
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
const normalizedIdentity = (value: unknown) =>
  typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : '';
const documentField = (field: Field) => {
  const identity = normalizedIdentity(field.id),
    label = normalizedIdentity(field.label);
  return (
    identity === 'documentnumber' ||
    identity === 'numerocedula' ||
    identity === 'cedula' ||
    label.includes('cedula')
  );
};
export async function assertDirectoryIdentityAvailable(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fields: Field[],
  emailValue: unknown,
  data: Record<string, unknown>,
  exclude: { memberId?: string; campaignEntryId?: string } = {},
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
  const email = typeof emailValue === 'string' ? emailValue.trim().toLowerCase() : '';
  if (email) {
    const [member, entry] = await Promise.all([
      tx.affiliateMember.findFirst({
        where: { tenantId, email, ...(exclude.memberId ? { id: { not: exclude.memberId } } : {}) },
        select: { id: true },
      }),
      tx.affiliateCampaignEntry.findFirst({
        where: {
          tenantId,
          email,
          ...(exclude.campaignEntryId ? { id: { not: exclude.campaignEntryId } } : {}),
        },
        select: { id: true },
      }),
    ]);
    if (member || entry) fail(409, 'Este correo electrónico ya está registrado en otra división.');
  }
  const field = fields.find(documentField),
    document = field ? normalizedIdentity(data[field.id]) : '';
  if (!document) return;
  const duplicate = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m.id::text FROM "AffiliateMember" m
    JOIN "AffiliateNetwork" n ON n.id=m."networkId" AND n."tenantId"=m."tenantId"
    CROSS JOIN LATERAL jsonb_array_elements(n.fields) f
    WHERE m."tenantId"=${tenantId}::uuid
      AND (${exclude.memberId || null}::uuid IS NULL OR m.id<>${exclude.memberId || null}::uuid)
      AND (regexp_replace(lower(f->>'id'),'[^a-z0-9]','','g') IN ('documentnumber','numerocedula','cedula')
           OR translate(lower(f->>'label'),'áéíóúüñ','aeiouun') LIKE '%cedula%')
      AND regexp_replace(lower(COALESCE(m.data->>(f->>'id'),'')),'[^a-z0-9]','','g')=${document}
    UNION ALL
    SELECT e.id::text FROM "AffiliateCampaignEntry" e
    JOIN "AffiliateNetwork" n ON n.id=e."networkId" AND n."tenantId"=e."tenantId"
    CROSS JOIN LATERAL jsonb_array_elements(n.fields) f
    WHERE e."tenantId"=${tenantId}::uuid
      AND (${exclude.campaignEntryId || null}::uuid IS NULL OR e.id<>${exclude.campaignEntryId || null}::uuid)
      AND (regexp_replace(lower(f->>'id'),'[^a-z0-9]','','g') IN ('documentnumber','numerocedula','cedula')
           OR translate(lower(f->>'label'),'áéíóúüñ','aeiouun') LIKE '%cedula%')
      AND regexp_replace(lower(COALESCE(e.data->>(f->>'id'),'')),'[^a-z0-9]','','g')=${document}
    LIMIT 1`);
  if (duplicate.length) fail(409, 'Este número de cédula ya está registrado en otra división.');
}
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
    login_override: m.loginOverride,
    data: JSON.stringify(m.data),
    photo: m.photo && Buffer.from(m.photo),
    mime: m.mime,
    created: m.createdAt.toISOString(),
  };
/** Compatibility boundary for the existing member API; all production operations use Prisma/RLS. */
export class AffiliatesStore {
  async directoryBranding() {
    const directory = await this.prisma.platformDirectory.findUnique({
      where: { tenantId: this.tenantId },
      select: {
        name: true,
        slogan: true,
        divisionLabel: true,
        directoryAdminName: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
        backgroundColor: true,
        status: true,
      },
    });
    return (
      directory || {
        name: 'Directorio de Antioquia',
        slogan: 'Por Antioquia ¡Lo que sea!',
        divisionLabel: 'Subregiones',
        directoryAdminName: 'José Ignacio Cano',
        primaryColor: '#073d34',
        secondaryColor: '#032d27',
        accentColor: '#c8f000',
        backgroundColor: '#f5f8f5',
        status: 'ACTIVE',
      }
    );
  }
  async loginCandidates(email: string) {
    return this.tx(async (tx, n) => {
      const members = await tx.affiliateMember.findMany({
        where: { tenantId: n.tenantId, email, status: 'active' },
        include: { network: { select: { appId: true, name: true } } },
      });
      return members.map((m) => ({
        member: memberRow(m),
        appId: m.network.appId,
        name: m.network.name,
        store: new AffiliatesStore(this.prisma, this.tenantId, m.network.appId),
        url: `/affiliates/${this.tenantId}/${m.network.appId}/`,
      }));
    });
  }
  readonly features = new NetworkFeatures(this);
  readonly terms = new AffiliateTerms(this);
  readonly campaigns = new AffiliateCampaigns(this);
  readonly passwordRecovery = new AffiliatePasswordRecovery(this);
  async visible(viewer: string, target: string) {
    return memberRow(await this.features.visible(viewer, target));
  }
  readonly integrated = true;
  private requestContext = new AsyncLocalStorage<{
    actor: string;
    appId?: string;
    adminId?: string;
    platformAdminId?: string;
  }>();
  get isCommunityAdmin() {
    return !!this.requestContext.getStore()?.adminId;
  }
  get adminActorId() {
    return this.requestContext.getStore()?.adminId;
  }
  get isPlatformAdministrator() {
    return !!this.requestContext.getStore()?.platformAdminId;
  }
  get appId() {
    return this.requestContext.getStore()?.appId || this.defaultAppId;
  }
  async selectCommunity(me: any, id: string) {
    const context = this.requestContext.getStore();
    if (!context) throw new Error('Missing request context');
    const result = await this.tx(async (tx, n) => {
      if (!n.platformRoot || me.role !== 'ROOT')
        throw Object.assign(new Error('Solo el superadministrador administra otras subregiones.'), {
          status: 403,
        });
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
        throw Object.assign(new Error('Subregión inválida.'), { status: 400 });
      const target = await tx.affiliateNetwork.findFirst({
        where: { id, tenantId: this.tenantId },
      });
      if (!target) throw Object.assign(new Error('Subregión no disponible.'), { status: 404 });
      const root = await tx.affiliateMember.findFirst({
        where: { networkId: id, tenantId: this.tenantId, role: 'ROOT', parentId: null },
      });
      if (!root)
        throw Object.assign(new Error('La subregión no tiene usuario raíz.'), { status: 404 });
      return { appId: target.appId, root: memberRow(root) };
    });
    context.appId = result.appId;
    context.adminId = me.id;
    return result.root;
  }
  private get actor() {
    return this.requestContext.getStore()?.actor || 'affiliate-service';
  }
  request<T>(fn: () => T): T {
    return this.requestContext.run({ actor: 'anonymous' }, fn);
  }
  setActor(id: string, platformAdminId?: string) {
    const scope = this.requestContext.getStore();
    if (scope) {
      scope.actor = platformAdminId ? 'platform-admin:' + platformAdminId : 'affiliate:' + id;
      scope.platformAdminId = platformAdminId;
    }
  }
  constructor(
    readonly prisma: PrismaClient,
    readonly tenantId: string,
    private readonly defaultAppId: string,
  ) {}
  async tx<T>(
    fn: (tx: Prisma.TransactionClient, n: any) => Promise<T>,
    options: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${this.tenantId},true)`;
        const directory = await (tx as any).platformDirectory?.findUnique({
          where: { tenantId: this.tenantId },
          select: { status: true },
        });
        if (directory?.status === 'ARCHIVED')
          throw Object.assign(new Error('Este directorio está archivado.'), { status: 403 });
        const n = await tx.affiliateNetwork.findUnique({
          where: { tenantId_appId: { tenantId: this.tenantId, appId: this.appId } },
        });
        if (!n) throw Object.assign(new Error('Subregión no disponible.'), { status: 404 });
        return fn(tx, n);
      },
      { timeout: 15000, ...options },
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
          s && {
            token: s.token,
            member_id: s.memberId,
            csrf: s.csrf,
            expires: Number(s.expires),
            platform_admin_id: s.platformAdminId,
          }
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
        const memberData = JSON.parse(p[5]);
        await assertDirectoryIdentityAvailable(
          tx,
          this.tenantId,
          n.fields as Field[],
          p[3],
          memberData,
        );
        m = await tx.affiliateMember.create({
          data: {
            ...scope,
            id: p[0],
            parentId: p[1],
            name: p[2],
            email: p[3],
            password: p[4],
            role: 'MEMBER',
            data: memberData,
            createdAt: new Date(p[6]),
          },
        });
      } else if (q === 'UPDATE members SET name=?,email=?,data=?,status=? WHERE id=?') {
        const memberData = JSON.parse(p[2]);
        await assertDirectoryIdentityAvailable(
          tx,
          this.tenantId,
          n.fields as Field[],
          p[1],
          memberData,
          { memberId: p[4] },
        );
        m = await tx.affiliateMember.update({
          where: { tenantId_networkId_id: { ...scope, id: p[4] } },
          data: { name: p[0], email: p[1], data: memberData, status: p[3] },
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
