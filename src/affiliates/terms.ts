import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AffiliatesStore } from './store';

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export class AffiliateTerms {
  constructor(private store: AffiliatesStore) {}
  private admin(n: any, me: any) {
    if (!n.platformRoot || me.role !== 'ROOT' || this.store.isCommunityAdmin)
      fail(403, 'Solo el superusuario administra los términos de la plataforma.');
  }
  private latest(tx: Prisma.TransactionClient) {
    return tx.$queryRaw<any[]>`SELECT id, version, title, content, "publishedAt"
      FROM "AffiliateTermsVersion" WHERE "tenantId"=${this.store.tenantId}::uuid
      ORDER BY version DESC LIMIT 1`;
  }
  async status(me: any) {
    return this.store.tx(async (tx, n) => {
      const [current] = await this.latest(tx);
      const acceptance = current && await tx.$queryRaw<any[]>`
        SELECT "acceptedAt" FROM "AffiliateTermsAcceptance"
        WHERE "tenantId"=${n.tenantId}::uuid AND "memberId"=${me.id}::uuid
          AND "networkId"=${n.id}::uuid AND "versionId"=${current.id}::uuid`;
      return { current: current || null, required: !!current && !acceptance?.length,
        acceptedAt: acceptance?.[0]?.acceptedAt || null };
    });
  }
  async requireAccepted(me: any) {
    const required = await this.store.tx(async (tx, n) => {
      const rows = await tx.$queryRaw<{ required: boolean }[]>`
        SELECT NOT EXISTS (SELECT 1 FROM "AffiliateTermsAcceptance" a
          WHERE a."tenantId"=${n.tenantId}::uuid AND a."networkId"=${n.id}::uuid
            AND a."memberId"=${me.id}::uuid AND a."versionId"=v.id) AS required
        FROM "AffiliateTermsVersion" v WHERE v."tenantId"=${n.tenantId}::uuid
        ORDER BY v.version DESC LIMIT 1`;
      return rows[0]?.required || false;
    });
    if (required)
      fail(428, 'Debes aceptar los términos y condiciones vigentes para continuar.');
  }
  async history(me: any) {
    return this.store.tx(async (tx, n) => {
      this.admin(n, me);
      const versions = await tx.$queryRaw<any[]>`SELECT id, version, title, content, "publishedAt"
        FROM "AffiliateTermsVersion" WHERE "tenantId"=${n.tenantId}::uuid ORDER BY version DESC`;
      return { versions };
    });
  }
  async publish(me: any, input: any) {
    if (typeof input?.title !== 'string' || !input.title.trim() || input.title.length > 200 ||
        typeof input?.content !== 'string' || !input.content.trim() || input.content.length > 100000)
      fail(400, 'Indica un título (máximo 200 caracteres) y el texto (máximo 100.000 caracteres).');
    if (input.confirmPublish !== true) fail(400, 'Confirma la publicación de los términos.');
    return this.store.tx(async (tx, n) => {
      this.admin(n, me);
      // Serialize publications and acceptance against the same tenant lock.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${n.tenantId}::uuid FOR UPDATE`;
      const [current] = await this.latest(tx);
      if (input.expectedVersionId !== (current?.id || null))
        fail(409, 'Los términos cambiaron. Recarga y revisa la versión vigente.');
      const title = input.title.trim(), content = input.content.trim();
      if (current?.title === title && current?.content === content)
        fail(409, 'El contenido ya coincide con la versión vigente.');
      const id = randomUUID(), version = (current?.version || 0) + 1;
      await tx.$executeRaw`INSERT INTO "AffiliateTermsVersion"
        (id,"tenantId",version,title,content,"publishedBy")
        VALUES (${id}::uuid,${n.tenantId}::uuid,${version},${title},${content},${me.id}::uuid)`;
      await tx.auditLog.create({ data: { tenantId: n.tenantId, actor: 'affiliate:' + me.id,
        action: 'terms.published', resourceId: id, details: { version } } });
      return { id, version };
    });
  }
  async accept(me: any, input: any) {
    if (input?.accepted !== true || typeof input.versionId !== 'string' ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.versionId))
      fail(400, 'Confirma que aceptas la versión mostrada.');
    return this.store.tx(async (tx, n) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${n.tenantId}::uuid FOR UPDATE`;
      const [current] = await this.latest(tx);
      if (!current || current.id !== input.versionId)
        fail(409, 'Hay una nueva versión. Revísala antes de aceptar.');
      const inserted = await tx.$executeRaw`INSERT INTO "AffiliateTermsAcceptance"
        ("tenantId","networkId","memberId","versionId")
        VALUES (${n.tenantId}::uuid,${n.id}::uuid,${me.id}::uuid,${current.id}::uuid)
        ON CONFLICT ("tenantId","memberId","versionId") DO NOTHING`;
      if (inserted) await tx.auditLog.create({ data: { tenantId: n.tenantId,
        actor: 'affiliate:' + me.id, action: 'terms.accepted', resourceId: current.id,
        details: { version: current.version, memberId: me.id, networkId: n.id } } });
      return { ok: true };
    });
  }
}
