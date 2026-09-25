import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PaymentsController } from '../src/payments/payments.controller';
import { sameSecret } from '../src/payments/payment-events.controller';
import { TenantContextManager } from '../src/security/tenant-context.manager';
import { SecretsService } from '../src/security/secrets.service';
import { PaymentStrategyFactory } from '../src/payments/payments.strategy';
import { WorkflowEngineService } from '../src/core/workflow-engine.service';
test('callback secret comparison rejects empty, altered and truncated tokens', () => {
  assert.equal(sameSecret('abc', 'abcd'), false);
  assert.equal(sameSecret('abce', 'abcd'), false);
  assert.equal(sameSecret('abcd', 'abcd'), true);
});
for (const difference of ['reference', 'amountMinor', 'currency'] as const) {
  test('payment confirmation rejects mismatched ' + difference, async () => {
    const id = randomUUID(),
      appId = randomUUID();
    let events = 0;
    const payment = {
      id,
      appId,
      provider: 'stripe',
      providerId: 'cs_1',
      status: 'PENDING',
      amountMinor: 10000,
      currency: 'COP',
    };
    const tx = {
      paymentTransaction: { findFirstOrThrow: async () => payment },
      gatewayConfig: { findUniqueOrThrow: async () => ({ secretRef: 'SECRET' }) },
    };
    const context = {
      app: async () => {},
      tx: async (fn: Function) => fn(tx, { tenantId: randomUUID() }),
    } as unknown as TenantContextManager;
    const secrets = { resolve: () => '{"secretKey":"key"}' } as unknown as SecretsService;
    const state = {
      paid: true,
      reference: id,
      amountMinor: 10000,
      currency: 'COP',
      [difference]: difference === 'amountMinor' ? 1 : 'wrong',
    };
    const factory = {
      get: () => ({ verify: async () => state }),
    } as unknown as PaymentStrategyFactory;
    const workflows = { enqueue: async () => events++ } as unknown as WorkflowEngineService;
    await assert.rejects(
      new PaymentsController(context, secrets, factory, workflows).reconcile(appId, id, {}),
      /does not match/,
    );
    assert.equal(events, 0);
  });
}
