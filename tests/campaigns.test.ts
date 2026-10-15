import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AffiliateCampaigns } from '../src/affiliates/campaigns';

const network = {
  id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222',
  fields: [
    { id: 'firstNames', label: 'Nombres', type: 'text', required: true },
    { id: 'phone', label: 'Celular', type: 'tel', required: false },
  ],
};

test('only a level-zero leader creates campaigns with existing fields', async () => {
  const creates: any[] = [];
  const tx = {
    affiliateCampaign: { create: async ({ data }: any) => (creates.push(data), { id: 'campaign', ...data }) },
    auditLog: { create: async () => ({}) },
  };
  const campaigns = new AffiliateCampaigns({ tx: async (fn: any) => fn(tx, network) } as any);
  await assert.rejects(campaigns.create({ id: 'member', role: 'MEMBER' }, { name: 'Evento', fieldIds: ['firstNames'] }), { status: 403 });
  const result = await campaigns.create({ id: 'root', role: 'ROOT' }, { name: ' Evento ', fieldIds: ['firstNames', '__email'] });
  assert.equal(result.campaign.name, 'Evento');
  assert.deepEqual(creates[0].fieldIds, ['firstNames', '__email']);
  await assert.rejects(campaigns.create({ id: 'root', role: 'ROOT' }, { name: 'Evento', fieldIds: ['unknown'] }), { status: 400 });
});

test('public campaign exposes only selected fields and keeps its token stable', async () => {
  const campaign = { id: 'campaign', tenantId: network.tenantId, networkId: network.id, token: 'stable-token-123456789012345', name: 'Puerta a puerta', fieldIds: ['firstNames'], enabled: true, network: { name: 'Valle de Aburrá', fields: network.fields } };
  const tx = { affiliateCampaign: { findUnique: async () => campaign } };
  const campaigns = new AffiliateCampaigns({ tx: async (fn: any) => fn(tx, network) } as any);
  const form = await campaigns.publicForm(campaign.token);
  assert.deepEqual(form.fields.map((field) => field.id), ['firstNames']);
  assert.equal(form.includeEmail, false);
  assert.equal(campaign.token, 'stable-token-123456789012345');
});

test('public submission is stored in its campaign and disabled campaigns reject new data', async () => {
  const saved: any[] = [];
  const campaign: any = { id: '33333333-3333-4333-8333-333333333333', tenantId: network.tenantId, networkId: network.id, fieldIds: ['firstNames'], enabled: true, network: { fields: network.fields } };
  const tx = {
    affiliateCampaign: { findUnique: async () => campaign },
    affiliateCampaignEntry: { create: async ({ data }: any) => (saved.push(data), { id: 'entry', ...data }) },
  };
  const campaigns = new AffiliateCampaigns({ tx: async (fn: any) => fn(tx, network) } as any);
  await campaigns.submit('stable-token-123456789012345', { data: { firstNames: 'Daniel', phone: 'no debe guardarse' } });
  assert.deepEqual(saved[0].data, { firstNames: 'Daniel' });
  campaign.enabled = false;
  await assert.rejects(campaigns.submit('stable-token-123456789012345', { data: { firstNames: 'Ana' } }), { status: 410 });
});
