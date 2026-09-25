import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createForm, mirrorMember } from '../src/affiliates/store';
const { DatabaseSync } = require('node:sqlite');
async function main() {
  const root = path.resolve('affiliates/data');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'superapp-local.json'), 'utf8'));
  const source = new DatabaseSync(path.join(root, 'affiliates.sqlite'), { readOnly: true });
  const org = source.prepare('SELECT * FROM organization WHERE id=1').get();
  if (!org) throw new Error('Configura primero la organización local.');
  const members = source
    .prepare(
      'WITH RECURSIVE t AS (SELECT *,0 AS depth FROM members WHERE parent_id IS NULL UNION ALL SELECT m.*,t.depth+1 FROM members m JOIN t ON m.parent_id=t.id) SELECT * FROM t ORDER BY depth,created',
    )
    .all();
  if (members.length !== source.prepare('SELECT count(*) AS n FROM members').get().n)
    throw new Error('El árbol contiene registros sin raíz; migración detenida.');
  const sessions = source.prepare('SELECT * FROM sessions WHERE expires>?').all(Date.now());
  const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${config.tenantId},true)`;
        if (await tx.affiliateNetwork.findUnique({ where: { appId: config.appId } }))
          throw new Error('La aplicación ya fue importada. No se sobrescribieron datos.');
        await tx.tenant.create({
          data: {
            id: config.tenantId,
            slug: 'afiliados-' + config.tenantId.slice(0, 8),
            subscriptionStatus: 'ACTIVE',
          },
        });
        await tx.app.create({
          data: {
            id: config.appId,
            tenantId: config.tenantId,
            name: 'Plataforma Afiliados',
            bundleId: 'com.superapp.afiliados',
            theme: { primary: '#174e3c', background: '#f4f6f3', fontFamily: 'Roboto', radius: 12 },
          },
        });
        const fields = JSON.parse(org.fields),
          schema = await createForm(tx, config.tenantId, config.appId, fields, 1);
        const network = await tx.affiliateNetwork.create({
          data: {
            id: config.networkId,
            tenantId: config.tenantId,
            appId: config.appId,
            name: org.name,
            approvalStatus:'APPROVED',platformRoot:true,
            fields,
            schemaId: schema.id,
          },
        });
        for (const m of members) {
          const created = await tx.affiliateMember.create({
            data: {
              id: m.id,
              tenantId: config.tenantId,
              networkId: network.id,
              parentId: m.parent_id,
              name: m.name,
              email: m.email,
              password: m.password,
              role: m.role,
              status: m.status,
              data: JSON.parse(m.data),
              photo: m.photo && Buffer.from(m.photo),
              mime: m.mime,
              createdAt: new Date(m.created),
            },
          });
          await mirrorMember(tx, network, created);
        }
        for (const s of sessions)
          await tx.affiliateSession.create({
            data: {
              token: s.token,
              tenantId: config.tenantId,
              networkId: network.id,
              memberId: s.member_id,
              csrf: s.csrf,
              expires: BigInt(s.expires),
            },
          });
        const rootMember = members.find((m: any) => m.role === 'ROOT');
        await tx.membership.create({
          data: { tenantId: config.tenantId, subject: 'affiliate:' + rootMember.id, role: 'OWNER' },
        });
        await tx.auditLog.create({
          data: {
            tenantId: config.tenantId,
            actor: 'local-migration',
            action: 'affiliates.imported',
            resourceId: config.appId,
            details: {
              members: members.length,
              photos: members.filter((m: any) => m.photo).length,
            },
          },
        });
        return {
          members: members.length,
          photos: members.filter((m: any) => m.photo).length,
          fields: fields.length,
          sessions: sessions.length,
        };
      },
      { timeout: 60000 },
    );
    fs.writeFileSync(
      path.join(root, 'migration-report.json'),
      JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2),
    );
    console.log('Migración completada:', JSON.stringify(result));
  } finally {
    source.close();
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
