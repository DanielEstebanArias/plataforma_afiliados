import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MqttIngestService } from '../src/core/mqtt-ingest.service';
import { AuthService } from '../src/security/auth';
import { TenantContextManager } from '../src/security/tenant-context.manager';
import { GISController } from '../src/core/gis.controller';
test('MQTT rejects a valid token publishing into a different tenant topic', async () => {
  const tenantId = randomUUID(),
    appId = randomUUID();
  let writes = 0;
  const auth = {
    verify: async () => ({ tenantId, appId, subject: 'device', role: 'DEVICE' }),
  } as unknown as AuthService;
  const context = { run: (_p: unknown, fn: Function) => fn() } as unknown as TenantContextManager;
  const gis = {
    position: async () => {
      writes++;
    },
  } as unknown as GISController;
  const service = new MqttIngestService(auth, context, gis);
  const payload = Buffer.from(
    JSON.stringify({
      token: 'token',
      appId,
      position: {
        deviceId: 'device',
        latitude: 4,
        longitude: -74,
        capturedAt: '2026-09-24T12:00:00Z',
      },
    }),
  );
  await assert.rejects(
    service.ingest(`superapp/${randomUUID()}/${appId}/positions`, payload),
    /tenant mismatch/,
  );
  assert.equal(writes, 0);
  await service.ingest(`superapp/${tenantId}/${appId}/positions`, payload);
  assert.equal(writes, 1);
});
