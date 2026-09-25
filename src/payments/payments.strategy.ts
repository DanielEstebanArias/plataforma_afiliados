import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { approvedFetch } from '../core/outbound';
export type CheckoutRequest = {
  id: string;
  title: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  customer: {
    email: string;
    name: string;
    phone: string;
    document: string;
  };
};
export type CheckoutResult = {
  providerId: string;
  url: string;
  form?: Record<string, string>;
};
export type PaymentState = {
  paid: boolean;
  reference: string;
  amountMinor: number;
  currency: string;
};
export type Credentials = Record<string, string>;
export interface PaymentStrategy {
  create(request: CheckoutRequest, credentials: Credentials): Promise<CheckoutResult>;
  verify(reference: string, providerId: string, credentials: Credentials): Promise<PaymentState>;
}
const money = (minor: number) => (minor / 100).toFixed(2);
const required = (c: Credentials, key: string) => z.string().min(1).parse(c[key]);
async function json(url: string, init: RequestInit): Promise<any> {
  return (await approvedFetch(url, init)).json();
}
const bearer = (key: string) => ({
  authorization: 'Bearer ' + key,
  'content-type': 'application/json',
});
export class StripeStrategy implements PaymentStrategy {
  async create(r: CheckoutRequest, c: Credentials) {
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: r.returnUrl,
      cancel_url: r.returnUrl,
      client_reference_id: r.id,
      customer_email: r.customer.email,
      'line_items[0][price_data][currency]': r.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(r.amountMinor),
      'line_items[0][price_data][product_data][name]': r.title,
      'line_items[0][quantity]': '1',
    });
    const result = await json('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + required(c, 'secretKey'),
        'content-type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': r.id,
      },
      body,
    });
    return { providerId: result.id, url: result.url };
  }
  async verify(reference: string, id: string, c: Credentials) {
    const r = await json('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id), {
      headers: bearer(required(c, 'secretKey')),
    });
    return {
      paid: r.payment_status === 'paid',
      reference: r.client_reference_id,
      amountMinor: r.amount_total,
      currency: String(r.currency).toUpperCase(),
    };
  }
}
export class WompiStrategy implements PaymentStrategy {
  async create(r: CheckoutRequest, c: Credentials) {
    if (r.currency !== 'COP') throw new BadRequestException('Wompi Colombia requires COP');
    const signature = createHash('sha256')
      .update(r.id + r.amountMinor + r.currency + required(c, 'integritySecret'))
      .digest('hex');
    const query = new URLSearchParams({
      'public-key': required(c, 'publicKey'),
      currency: r.currency,
      'amount-in-cents': String(r.amountMinor),
      reference: r.id,
      'signature:integrity': signature,
      'redirect-url': r.returnUrl,
      'customer-data:email': r.customer.email,
    });
    return { providerId: r.id, url: 'https://checkout.wompi.co/p/?' + query };
  }
  async verify(reference: string, id: string, c: Credentials) {
    const host = c.environment === 'production' ? 'production.wompi.co' : 'sandbox.wompi.co';
    const { data } = await json('https://' + host + '/v1/transactions/' + encodeURIComponent(id), {
      headers: bearer(required(c, 'privateKey')),
    });
    return {
      paid: data.status === 'APPROVED',
      reference: data.reference,
      amountMinor: data.amount_in_cents,
      currency: data.currency,
    };
  }
}
export class MercadoPagoStrategy implements PaymentStrategy {
  async create(r: CheckoutRequest, c: Credentials) {
    const result = await json('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { ...bearer(required(c, 'accessToken')), 'X-Idempotency-Key': r.id },
      body: JSON.stringify({
        external_reference: r.id,
        items: [
          {
            id: r.id,
            title: r.title,
            quantity: 1,
            currency_id: r.currency,
            unit_price: r.amountMinor / 100,
          },
        ],
        payer: { email: r.customer.email },
        back_urls: { success: r.returnUrl, pending: r.returnUrl, failure: r.returnUrl },
        auto_return: 'approved',
      }),
    });
    return {
      providerId: result.id,
      url: c.environment === 'production' ? result.init_point : result.sandbox_init_point,
    };
  }
  async verify(reference: string, id: string, c: Credentials) {
    const result = await json(
      'https://api.mercadopago.com/v1/payments/search?external_reference=' +
        encodeURIComponent(reference),
      { headers: bearer(required(c, 'accessToken')) },
    );
    const payment = result.results?.find(
      (p: any) => p.status === 'approved' && p.external_reference === reference,
    );
    return payment
      ? {
          paid: true,
          reference: payment.external_reference,
          amountMinor: Math.round(payment.transaction_amount * 100),
          currency: payment.currency_id,
        }
      : { paid: false, reference, amountMinor: 0, currency: '' };
  }
}
export class PayPalStrategy implements PaymentStrategy {
  private host(c: Credentials) {
    return c.environment === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }
  private async token(c: Credentials) {
    return (
      await json(this.host(c) + '/v1/oauth2/token', {
        method: 'POST',
        headers: {
          authorization:
            'Basic ' +
            Buffer.from(required(c, 'clientId') + ':' + required(c, 'clientSecret')).toString(
              'base64',
            ),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
    ).access_token as string;
  }
  async create(r: CheckoutRequest, c: Credentials) {
    const result = await json(this.host(c) + '/v2/checkout/orders', {
      method: 'POST',
      headers: { ...bearer(await this.token(c)), 'PayPal-Request-Id': r.id },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: r.id,
            custom_id: r.id,
            description: r.title,
            amount: { currency_code: r.currency, value: money(r.amountMinor) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: r.returnUrl,
              cancel_url: r.returnUrl,
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });
    return {
      providerId: result.id,
      url: result.links.find((l: any) => ['approve', 'payer-action'].includes(l.rel)).href,
    };
  }
  async verify(reference: string, id: string, c: Credentials) {
    const token = await this.token(c),
      url = this.host(c) + '/v2/checkout/orders/' + encodeURIComponent(id);
    let order = await json(url, { headers: bearer(token) });
    if (order.status === 'APPROVED')
      order = await json(url + '/capture', {
        method: 'POST',
        headers: { ...bearer(token), 'PayPal-Request-Id': reference + '-capture' },
        body: '{}',
      });
    const unit = order.purchase_units?.[0],
      capture = unit?.payments?.captures?.[0];
    return {
      paid: order.status === 'COMPLETED' && capture?.status === 'COMPLETED',
      reference: unit?.custom_id ?? unit?.reference_id,
      amountMinor: Math.round(Number(capture?.amount?.value ?? 0) * 100),
      currency: capture?.amount?.currency_code ?? '',
    };
  }
}
export class PayUStrategy implements PaymentStrategy {
  async create(r: CheckoutRequest, c: Credentials) {
    const amount = money(r.amountMinor),
      merchantId = required(c, 'merchantId');
    const signature = createHash('sha256')
      .update(
        required(c, 'apiKey') + '~' + merchantId + '~' + r.id + '~' + amount + '~' + r.currency,
      )
      .digest('hex');
    return {
      providerId: r.id,
      url:
        c.environment === 'production'
          ? 'https://checkout.payulatam.com/ppp-web-gateway-payu/'
          : 'https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu/',
      form: {
        merchantId,
        accountId: required(c, 'accountId'),
        description: r.title,
        referenceCode: r.id,
        amount,
        currency: r.currency,
        signature,
        algorithmSignature: 'SHA256',
        tax: '0',
        taxReturnBase: '0',
        test: c.environment === 'production' ? '0' : '1',
        responseUrl: r.returnUrl,
        buyerEmail: r.customer.email,
        buyerFullName: r.customer.name,
        buyerDocument: r.customer.document,
        buyerDocumentType: 'CC',
        telephone: r.customer.phone,
        payerEmail: r.customer.email,
        payerFullName: r.customer.name,
        payerDocument: r.customer.document,
        payerDocumentType: 'CC',
        payerPhone: r.customer.phone,
      },
    };
  }
  async verify(reference: string, id: string, c: Credentials) {
    const host = c.environment === 'production' ? 'api.payulatam.com' : 'sandbox.api.payulatam.com';
    const r = await json('https://' + host + '/reports-api/4.0/service.cgi', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        test: c.environment !== 'production',
        language: 'en',
        command: 'ORDER_DETAIL_BY_REFERENCE_CODE',
        merchant: { apiLogin: required(c, 'apiLogin'), apiKey: required(c, 'apiKey') },
        details: { referenceCode: reference },
      }),
    });
    const orders = Array.isArray(r.result?.payload) ? r.result.payload : [r.result?.payload];
    const order = orders.find(
      (o: any) =>
        o?.referenceCode === reference &&
        o.transactions?.some((t: any) => t.transactionResponse?.state === 'APPROVED'),
    );
    const value = order?.additionalValues?.TX_VALUE;
    return {
      paid: !!order,
      reference: order?.referenceCode ?? reference,
      amountMinor: Math.round(Number(value?.value ?? 0) * 100),
      currency: value?.currency ?? '',
    };
  }
}
@Injectable()
export class PaymentStrategyFactory {
  private strategies = new Map<string, PaymentStrategy>([
    ['stripe', new StripeStrategy()],
    ['wompi', new WompiStrategy()],
    ['mercadopago', new MercadoPagoStrategy()],
    ['paypal', new PayPalStrategy()],
    ['payu', new PayUStrategy()],
  ]);
  register(name: string, strategy: PaymentStrategy) {
    this.strategies.set(name, strategy);
  }
  get(name: string) {
    const strategy = this.strategies.get(name);
    if (!strategy) throw new BadRequestException('Unsupported gateway');
    return strategy;
  }
}
