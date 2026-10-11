import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { column, createForm, mirrorMember } from '../src/affiliates/store';

const SUBREGIONS = ['Valle de Aburrá','Bajo Cauca','Norte','Nordeste','Suroeste','Occidente','Oriente','Urabá','Magdalena Medio'];
const FIELDS = [
  { id: 'firstNames', label: 'Nombres', type: 'text', required: true },
  { id: 'lastNames', label: 'Apellidos', type: 'text', required: true },
  { id: 'documentNumber', label: 'Número de cédula', type: 'text', required: true },
  { id: 'municipality', label: 'Municipio', type: 'text', required: true },
  { id: 'neighborhood', label: 'Barrio', type: 'text', required: true },
  { id: 'birthDate', label: 'Fecha de nacimiento', type: 'date', required: true },
  { id: 'phone', label: 'Número de celular', type: 'tel', required: true },
  { id: 'voteContribution', label: 'Aporte en votos', type: 'number', required: true },
];
const VALLE_MUNICIPALITIES = ['Barbosa','Bello','Caldas','Copacabana','Envigado','Girardota','Itagüí','La Estrella','Medellín','Sabaneta'];
const DEMO_DOMAIN = 'demo.aliados-antioquia.invalid';
const db = new PrismaClient();
function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}
const tenantId = requiredEnv('AFFILIATES_TENANT_ID');
const appId = requiredEnv('AFFILIATES_APP_ID');

function passwordHash() {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(randomBytes(32), salt, 64).toString('hex');
}

async function main() {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
    const base = await tx.affiliateNetwork.findUniqueOrThrow({ where: { tenantId_appId: { tenantId, appId } } });
    if (!base.platformRoot) throw new Error('La aplicación configurada no es la subregión principal.');

    const obsolete = await tx.affiliateNetwork.findMany({ where: { tenantId, id: { not: base.id } }, select: { id: true, appId: true } });
    for (const network of obsolete) {
      await tx.affiliateNetwork.delete({ where: { tenantId_id: { tenantId, id: network.id } } });
      await tx.app.delete({ where: { tenantId_id: { tenantId, id: network.appId } } });
    }

    await tx.app.update({ where: { tenantId_id: { tenantId, id: base.appId } }, data: { name: 'Valle de Aburrá' } });
    let version = base.formVersion + 1;
    const baseSchema = await createForm(tx, tenantId, base.appId, FIELDS, version);
    const valle = await tx.affiliateNetwork.update({
      where: { tenantId_id: { tenantId, id: base.id } },
      data: { name: 'Valle de Aburrá', fields: FIELDS, schemaId: baseSchema.id, formVersion: version, approvalStatus: 'APPROVED', maxLoginLevel: 0 },
    });
    const existing = await tx.affiliateMember.findMany({ where: { tenantId, networkId: valle.id } });
    for (const member of existing) await mirrorMember(tx, valle, member);

    const roots: Record<string, string> = {};
    for (const name of SUBREGIONS.slice(1)) {
      const newAppId = randomUUID(), networkId = randomUUID(), rootId = randomUUID();
      await tx.app.create({ data: { id: newAppId, tenantId, name, bundleId: 'com.aliados.a' + newAppId.replaceAll('-', '') } });
      const schema = await createForm(tx, tenantId, newAppId, FIELDS, 1);
      const network = await tx.affiliateNetwork.create({ data: {
        id: networkId, tenantId, appId: newAppId, name, fields: FIELDS, schemaId: schema.id,
        formVersion: 1, approvalStatus: 'APPROVED', platformRoot: false, maxLoginLevel: 0,
        modules: { access: true, dashboard: true, form: true, createCommunities: false },
      } });
      const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
      const root = await tx.affiliateMember.create({ data: {
        id: rootId, tenantId, networkId, parentId: null, name: `Administrador ${name}`,
        email: `administrador.${slug}@${DEMO_DOMAIN}`, password: passwordHash(), role: 'ROOT', status: 'active', data: {},
      } });
      await mirrorMember(tx, network, root);
      roots[name] = root.id;
    }

    await tx.affiliateMember.deleteMany({ where: { tenantId, networkId: valle.id, email: { endsWith: '@' + DEMO_DOMAIN } } });
    const valleRoot = await tx.affiliateMember.findFirstOrThrow({ where: { tenantId, networkId: valle.id, role: 'ROOT', parentId: null } });
    const commonPassword = passwordHash();
    const demo = Array.from({ length: 1001 }, (_, index) => {
      const n = index + 1, id = randomUUID();
      const firstNames = `Aliado ficticio ${String(n).padStart(4, '0')}`;
      const lastNames = 'Prueba Valle de Aburrá';
      return {
        id, tenantId, networkId: valle.id, parentId: valleRoot.id, name: `${firstNames} ${lastNames}`,
        email: `aliado.${String(n).padStart(4, '0')}@${DEMO_DOMAIN}`, password: commonPassword,
        role: 'MEMBER', status: 'active', data: {
          firstNames, lastNames, documentNumber: `FICTICIA-VA-${String(n).padStart(6, '0')}`,
          municipality: VALLE_MUNICIPALITIES[index % VALLE_MUNICIPALITIES.length],
          neighborhood: `Barrio ficticio ${(index % 50) + 1}`, birthDate: `${1970 + (index % 35)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
          phone: `FICTICIO-${String(n).padStart(6, '0')}`, voteContribution: String(index % 21),
        },
      };
    });
    for (let i = 0; i < demo.length; i += 250) await tx.affiliateMember.createMany({ data: demo.slice(i, i + 250) });
    const records = demo.map((m) => ({
      id: randomUUID(), tenantId, schemaId: valle.schemaId, idempotencyKey: m.id,
      data: {
        name: m.name, email: m.email, parent_id: m.parentId, status: m.status,
        ...Object.fromEntries(FIELDS.map((field) => [column(field.id), field.type === 'number' ? Number((m.data as any)[field.id]) : (m.data as any)[field.id]])),
      },
    }));
    for (let i = 0; i < records.length; i += 250) await tx.dynamicRecord.createMany({ data: records.slice(i, i + 250) as Prisma.DynamicRecordCreateManyInput[] });
    return { removedSubregions: obsolete.length, subregions: SUBREGIONS.length, syntheticAllies: demo.length, valleTotal: existing.length + demo.length };
  }, { timeout: 120000 });
  console.log(JSON.stringify(result, null, 2));
}
main().finally(() => db.$disconnect());
