import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { assertDirectoryIdentityAvailable, type AffiliatesStore } from './store';

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
const uuid = (value: unknown) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    fail(400, 'Identificador inválido.');
  return value;
};
type Field = { id: string; label: string; type: string; required: boolean; options?: string[] };

function validateValue(field: Field, value: unknown) {
  if (value === undefined || value === '' || value === null) {
    if (field.required) fail(400, `Completa ${field.label}.`);
    return;
  }
  if (field.type === 'checkbox') {
    if (typeof value !== 'boolean') fail(400, `Valor inválido: ${field.label}.`);
    return;
  }
  if (typeof value !== 'string' || value.length > 4000)
    fail(400, `Valor inválido: ${field.label}.`);
  if (field.type === 'select' && !field.options?.includes(value))
    fail(400, `Selecciona una opción de ${field.label}.`);
  if (field.type === 'number' && !Number.isFinite(Number(value)))
    fail(400, `Número inválido: ${field.label}.`);
  if (field.type === 'email' && !/^\S+@\S+\.\S+$/.test(value))
    fail(400, `Correo inválido: ${field.label}.`);
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(400, `Fecha inválida: ${field.label}.`);
}

export class AffiliateCampaigns {
  constructor(private store: AffiliatesStore) {}
  private root(me: any) {
    if (me?.role !== 'ROOT') fail(403, 'Solo el líder de nivel cero administra campañas.');
  }
  async list(me: any) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      const campaigns = await tx.affiliateCampaign.findMany({
        where: { tenantId: n.tenantId, networkId: n.id },
        include: { _count: { select: { entries: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return {
        campaigns: campaigns.map((campaign) => ({
          ...campaign,
          entries: campaign._count.entries,
          _count: undefined,
        })),
      };
    });
  }
  async create(me: any, input: any) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      if (typeof input?.name !== 'string' || !input.name.trim() || input.name.trim().length > 150)
        fail(400, 'Escribe un nombre válido de máximo 150 caracteres.');
      if (
        !Array.isArray(input.fieldIds) ||
        !input.fieldIds.length ||
        input.fieldIds.some((id: any) => typeof id !== 'string')
      )
        fail(400, 'Selecciona al menos un campo para la campaña.');
      const fields = n.fields as Field[];
      const allowed = new Set([...fields.map((field) => field.id), '__name', '__email']);
      const fieldIds = [...new Set(input.fieldIds as string[])];
      if (fieldIds.some((id) => !allowed.has(id)))
        fail(400, 'La campaña contiene campos no disponibles.');
      const campaign = await tx.affiliateCampaign.create({
        data: {
          tenantId: n.tenantId,
          networkId: n.id,
          token: randomBytes(24).toString('base64url'),
          name: input.name.trim(),
          fieldIds,
          createdBy: me.id,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: n.tenantId,
          actor: `affiliate:${me.id}`,
          action: 'campaign.created',
          resourceId: campaign.id,
          details: { networkId: n.id, name: campaign.name, fieldIds },
        },
      });
      return { campaign };
    });
  }
  async update(me: any, id: string, input: any) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      const campaign = await tx.affiliateCampaign.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId, networkId: n.id },
      });
      if (!campaign) fail(404, 'Campaña no disponible.');
      const data: any = {};
      if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean') fail(400, 'Estado de campaña inválido.');
        data.enabled = input.enabled;
      }
      if (input.name !== undefined) {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150)
          fail(400, 'Nombre de campaña inválido.');
        data.name = input.name.trim();
      }
      const updated = await tx.affiliateCampaign.update({ where: { id: campaign.id }, data });
      await tx.auditLog.create({
        data: {
          tenantId: n.tenantId,
          actor: `affiliate:${me.id}`,
          action: 'campaign.updated',
          resourceId: campaign.id,
          details: data,
        },
      });
      return { campaign: updated };
    });
  }
  async entries(me: any, params: URLSearchParams) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      const campaignId = params.get('campaignId') || undefined;
      const after = params.get('after') || undefined;
      const query = (params.get('q') || '').trim().slice(0, 120);
      const limit = Number(params.get('limit') || 100);
      if (campaignId) uuid(campaignId);
      if (after) uuid(after);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(400, 'Tamaño de página inválido.');
      const baseWhere: any = {
        tenantId: n.tenantId,
        networkId: n.id,
        ...(campaignId ? { campaignId } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const where = { ...baseWhere, ...(after ? { id: { gt: after } } : {}) };
      const [entries, total] = await Promise.all([
        tx.affiliateCampaignEntry.findMany({
          where,
          include: { campaign: { select: { id: true, name: true } } },
          orderBy: { id: 'asc' },
          take: limit + 1,
        }),
        tx.affiliateCampaignEntry.count({ where: baseWhere }),
      ]);
      return {
        entries: entries.slice(0, limit),
        total,
        nextCursor: entries.length > limit ? entries[limit - 1].id : null,
      };
    });
  }
  async updateEntry(me: any, id: string, input: any) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      const entry = await tx.affiliateCampaignEntry.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId, networkId: n.id },
      });
      if (!entry) fail(404, 'Registro de campaña no disponible.');
      const fields = n.fields as Field[],
        data = input?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Datos inválidos.');
      for (const field of fields) validateValue({ ...field, required: false }, data[field.id]);
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 150) : entry.name;
      const email =
        typeof input.email === 'string'
          ? input.email.trim().toLowerCase().slice(0, 254)
          : entry.email;
      if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Escribe un correo válido.');
      await assertDirectoryIdentityAvailable(tx, n.tenantId, fields, email, data, {
        campaignEntryId: entry.id,
      });
      const updated = await tx.affiliateCampaignEntry.update({
        where: { id: entry.id },
        data: { name, email, data },
      });
      await tx.auditLog.create({
        data: {
          tenantId: n.tenantId,
          actor: `affiliate:${me.id}`,
          action: 'campaign.entry.updated',
          resourceId: entry.id,
          details: { campaignId: entry.campaignId },
        },
      });
      return { entry: updated };
    });
  }
  async publicForm(token: string) {
    return this.store.tx(async (tx, n) => {
      const campaign = await tx.affiliateCampaign.findUnique({
        where: { token },
        include: { network: { select: { name: true, fields: true } } },
      });
      if (!campaign || campaign.tenantId !== n.tenantId) fail(404, 'Campaña no disponible.');
      const selected = new Set(campaign.fieldIds as string[]),
        fields = campaign.network.fields as Field[];
      return {
        name: campaign.name,
        community: campaign.network.name,
        enabled: campaign.enabled,
        fields: fields.filter((field) => selected.has(field.id)),
        includeName: selected.has('__name'),
        includeEmail: selected.has('__email'),
      };
    });
  }
  async submit(token: string, input: any) {
    return this.store.tx(async (tx, n) => {
      const campaign = await tx.affiliateCampaign.findUnique({
        where: { token },
        include: { network: { select: { fields: true } } },
      });
      if (!campaign || campaign.tenantId !== n.tenantId) fail(404, 'Campaña no disponible.');
      if (!campaign.enabled) fail(410, 'Esta campaña ya no está recibiendo registros.');
      if (input?.website) fail(400, 'No se pudo enviar el formulario.');
      const selected = new Set(campaign.fieldIds as string[]),
        allFields = campaign.network.fields as Field[];
      const data = input?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Datos inválidos.');
      const clean: Record<string, any> = {};
      for (const field of allFields.filter((field) => selected.has(field.id))) {
        validateValue(field, data[field.id]);
        if (data[field.id] !== undefined) clean[field.id] = data[field.id];
      }
      let name = '';
      if (selected.has('__name')) {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150)
          fail(400, 'Escribe un nombre válido.');
        name = input.name.trim();
      } else name = `${clean.firstNames ?? ''} ${clean.lastNames ?? ''}`.trim();
      let email = '';
      if (selected.has('__email')) {
        if (
          typeof input.email !== 'string' ||
          !/^\S+@\S+\.\S+$/.test(input.email) ||
          input.email.length > 254
        )
          fail(400, 'Escribe un correo válido.');
        email = input.email.trim().toLowerCase();
      }
      await assertDirectoryIdentityAvailable(tx, n.tenantId, allFields, email, clean);
      const entry = await tx.affiliateCampaignEntry.create({
        data: {
          tenantId: n.tenantId,
          networkId: campaign.networkId,
          campaignId: campaign.id,
          name,
          email,
          data: clean,
        },
      });
      return { ok: true, id: entry.id };
    });
  }
  async qr(me: any, id: string, url: string) {
    return this.store.tx(async (tx, n) => {
      this.root(me);
      const campaign = await tx.affiliateCampaign.findFirst({
        where: { id: uuid(id), tenantId: n.tenantId, networkId: n.id },
      });
      if (!campaign) fail(404, 'Campaña no disponible.');
      const svg = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 4,
        width: 2048,
        color: { dark: '#073D34', light: '#FFFFFF' },
      });
      return { svg, name: campaign.name };
    });
  }
}
