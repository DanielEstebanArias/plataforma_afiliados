import { Controller, Post, Param, Body, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TenantContextManager } from '../security/tenant-context.manager';
import { SecretsService } from '../security/secrets.service';
import { ProviderWebhook } from '../security/auth';
import { PaymentsController } from './payments.controller';
import { Provider } from '../contracts/app-config.schema';
import { approvedFetch } from '../core/outbound';
export function sameSecret(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
@Controller('payment-events')
export class PaymentEventsController {
  constructor(
    private readonly context: TenantContextManager,
    private readonly secrets: SecretsService,
    private readonly payments: PaymentsController,
  ) {}
  @Post(':tenantId/:appId/:provider/:token')
  @ProviderWebhook()
  async receive(
    @Param('appId')
    appId: string,
    @Param('provider')
    providerName: string,
    @Param('token')
    token: string,
    @Body()
    body: unknown,
  ) {
    const provider = Provider.parse(providerName);
    const gateway = await this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      return tx.gatewayConfig.findUnique({
        where: { tenantId_appId_provider: { tenantId: p.tenantId, appId, provider } },
      });
    });
    if (!gateway) throw new UnauthorizedException();
    const credentials = z
      .record(z.string())
      .parse(JSON.parse(this.secrets.resolve(gateway.secretRef)));
    const expected = credentials.webhookToken;
    if (!expected || expected.length < 43 || !sameSecret(token, expected))
      throw new UnauthorizedException();
    const event = z.record(z.unknown()).parse(body);
    let reference: string | undefined, providerId: string | undefined;
    if (provider === 'stripe') {
      if (
        !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
          String(event.type),
        )
      )
        return { received: true };
      const data = z
        .object({
          object: z.object({ id: z.string(), client_reference_id: z.string() }).passthrough(),
        })
        .passthrough()
        .parse(event.data);
      reference = data.object.client_reference_id;
      providerId = data.object.id;
    } else if (provider === 'wompi') {
      const data = z
        .object({ transaction: z.object({ id: z.string(), reference: z.string() }).passthrough() })
        .passthrough()
        .parse(event.data);
      reference = data.transaction.reference;
      providerId = data.transaction.id;
    } else if (provider === 'mercadopago') {
      const data = z
        .object({ id: z.union([z.string(), z.number()]) })
        .passthrough()
        .parse(event.data);
      const response = await approvedFetch(
        'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(String(data.id)),
        { headers: { authorization: 'Bearer ' + credentials.accessToken } },
      );
      const verified = z
        .object({ external_reference: z.string() })
        .passthrough()
        .parse(await response.json());
      reference = verified.external_reference;
    } else if (provider === 'payu') {
      reference = z.string().parse(event.reference_sale);
      providerId = reference;
    } else {
      if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return { received: true };
      const resource = z
        .object({
          supplementary_data: z
            .object({ related_ids: z.object({ order_id: z.string() }).passthrough() })
            .passthrough(),
        })
        .passthrough()
        .parse(event.resource);
      providerId = resource.supplementary_data.related_ids.order_id;
    }
    const payment = await this.context.tx((tx) =>
      tx.paymentTransaction.findFirst({
        where: { appId, provider, ...(reference ? { id: reference } : { providerId }) },
      }),
    );
    if (!payment) return { received: true };
    await this.payments.reconcile(appId, payment.id, providerId ? { providerId } : {});
    return { received: true };
  }
}
