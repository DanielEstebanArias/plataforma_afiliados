import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  StripeStrategy,
  WompiStrategy,
  PayUStrategy,
  PayPalStrategy,
  PaymentStrategyFactory,
  CheckoutRequest,
} from '../src/payments/payments.strategy';
const request: CheckoutRequest = {
  id: 'order123',
  title: 'Inspection',
  amountMinor: 12345,
  currency: 'COP',
  returnUrl: 'https://engine.example.com/return',
  customer: { email: 'test@example.com', name: 'Customer', phone: '1234567', document: '1234567' },
};
test('Wompi signs the exact integer amount and server reference', async () => {
  const checkout = await new WompiStrategy().create(request, {
    publicKey: 'public',
    integritySecret: 'secret',
  });
  const query = new URL(checkout.url).searchParams;
  assert.equal(
    query.get('signature:integrity'),
    createHash('sha256').update('order12312345COPsecret').digest('hex'),
  );
  assert.equal(query.get('amount-in-cents'), '12345');
  assert.ok(!checkout.url.includes('secret'));
});
test('PayU uses a signed POST form and does not expose the API key', async () => {
  const checkout = await new PayUStrategy().create(request, {
    merchantId: '1',
    accountId: '2',
    apiKey: 'private-secret',
  });
  assert.equal(checkout.form!.amount, '123.45');
  assert.equal(checkout.form!.algorithmSignature, 'SHA256');
  assert.equal(
    checkout.form!.signature,
    createHash('sha256').update('private-secret~1~order123~123.45~COP').digest('hex'),
  );
  assert.ok(!JSON.stringify(checkout).includes('private-secret'));
});
test('Stripe uses provider idempotency and trusted price', async (t) => {
  process.env.OUTBOUND_HOSTS = 'api.stripe.com';
  let observed: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    observed = init;
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/test' }));
  });
  await new StripeStrategy().create(request, { secretKey: 'secret' });
  assert.equal((observed!.headers as Record<string, string>)['Idempotency-Key'], request.id);
  assert.equal(
    (observed!.body as URLSearchParams).get('line_items[0][price_data][unit_amount]'),
    '12345',
  );
});
test('PayPal captures only approved orders and verifies captured amount', async (t) => {
  process.env.OUTBOUND_HOSTS = 'api-m.sandbox.paypal.com';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify(
        url.endsWith('token')
          ? { access_token: 'token' }
          : url.endsWith('capture')
            ? {
                status: 'COMPLETED',
                purchase_units: [
                  {
                    reference_id: 'order123',
                    payments: {
                      captures: [
                        { status: 'COMPLETED', amount: { value: '123.45', currency_code: 'COP' } },
                      ],
                    },
                  },
                ],
              }
            : { status: 'APPROVED' },
      ),
    );
  });
  const state = await new PayPalStrategy().verify('order123', 'provider1', {
    clientId: 'a',
    clientSecret: 'b',
  });
  assert.deepEqual(state, {
    paid: true,
    reference: 'order123',
    amountMinor: 12345,
    currency: 'COP',
  });
  assert.ok(calls.at(-1)!.endsWith('/capture'));
});
test('unknown strategy fails closed', () =>
  assert.throws(() => new PaymentStrategyFactory().get('arbitrary')));
