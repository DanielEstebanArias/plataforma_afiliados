import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppConfigSchema,
  ComponentSchema,
  TableSchema,
  validateRecord,
  HardwareSchema,
  FieldSchema,
} from '../src/contracts/app-config.schema';
import { randomUUID } from 'node:crypto';
test('hardware JSON fields accept structured scanner data', () => {
  const field = FieldSchema.parse({ name: 'tag', type: 'json', required: true });
  assert.deepEqual(validateRecord([field], { tag: { value: 'QR-123' } }), {
    tag: { value: 'QR-123' },
  });
  assert.throws(() => validateRecord([field], { tag: 'unstructured' }));
});
test('reject arbitrary hardware URLs and invalid geographic coordinates', () => {
  assert.throws(() =>
    HardwareSchema.parse({
      kind: 'gis',
      background: true,
      intervalSeconds: 5,
      transport: 'mqtt',
      endpoint: 'http://127.0.0.1',
      geofences: [],
    }),
  );
  assert.throws(() =>
    HardwareSchema.parse({
      kind: 'gis',
      background: true,
      intervalSeconds: 5,
      transport: 'websocket',
      geofences: [{ id: 'a', latitude: 100, longitude: 1, radiusMeters: 20 }],
    }),
  );
});
test('reject duplicate components and oversized trees before recursive validation', () => {
  assert.throws(() =>
    ComponentSchema.parse({
      id: 'root',
      type: 'FLEX',
      children: [
        { id: 'same', type: 'TEXT', text: 'a' },
        { id: 'same', type: 'TEXT', text: 'b' },
      ],
    }),
  );
  let node: unknown = { id: 'leaf', type: 'TEXT', text: 'x' };
  for (let i = 0; i < 25; i++) node = { id: 'layer_' + i, type: 'FLEX', children: [node] };
  assert.throws(() => ComponentSchema.parse(node));
});
test('validate tables and records without coercion or extra properties', () => {
  const schema = TableSchema.parse({
    name: 'inspection',
    fields: [{ name: 'score', type: 'number', required: true, min: 0, max: 10 }],
  });
  assert.deepEqual(validateRecord(schema.fields, { score: 5 }), { score: 5 });
  assert.throws(() => validateRecord(schema.fields, { score: '5' }));
  assert.throws(() => validateRecord(schema.fields, { score: 11 }));
  assert.throws(() => validateRecord(schema.fields, { score: 5, tenantId: randomUUID() }));
  assert.throws(() => TableSchema.parse({ name: 'x; DROP TABLE', fields: [] }));
  assert.throws(() =>
    TableSchema.parse({
      name: 'x',
      fields: [
        { name: 'score', type: 'text' },
        { name: 'score', type: 'text' },
      ],
    }),
  );
});
test('reject secrets accidentally inserted into metadata', () => {
  assert.throws(() =>
    AppConfigSchema.parse({
      schemaVersion: '1.0',
      appId: randomUUID(),
      revision: 1,
      version: '1.0.0',
      theme: { primary: '#2563EB', background: '#FFFFFF', fontFamily: 'Roboto', radius: 8 },
      screens: [],
      gateways: [{ provider: 'stripe', publicConfig: {}, secretRef: 'STRIPE_SECRET' }],
    }),
  );
});
test('required, boolean and ISO date validation', () => {
  const fields = [
    FieldSchema.parse({ name: 'accepted', type: 'boolean', required: true }),
    FieldSchema.parse({ name: 'date', type: 'date', required: true }),
  ];
  assert.throws(() => validateRecord(fields, { accepted: true, date: 'yesterday' }));
  assert.throws(() => validateRecord(fields, { date: '2026-09-24T12:00:00Z' }));
  assert.deepEqual(validateRecord(fields, { accepted: false, date: '2026-09-24T12:00:00Z' }), {
    accepted: false,
    date: '2026-09-24T12:00:00Z',
  });
});
