import {
  Body,
  Controller,
  Param,
  Post,
  Headers,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantContextManager } from '../security/tenant-context.manager';
import { SecretsService } from '../security/secrets.service';
import { Roles } from '../security/auth';
import { PaymentStrategyFactory, CheckoutResult } from './payments.strategy';
import { WorkflowEngineService } from '../core/workflow-engine.service';
import { Id, Provider } from '../contracts/app-config.schema';
@Controller('apps/:appId/payments')
export class PaymentsController {
  constructor(
    private readonly context: TenantContextManager,
    private readonly secrets: SecretsService,
    private readonly factory: PaymentStrategyFactory,
    private readonly workflows: WorkflowEngineService,
  ) {}
  @Post('offers')
  offer(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({
        title: z.string().min(1).max(100),
        provider: Provider,
        amountMinor: z.number().int().positive().max(2000000000),
        currency: z.enum(['USD', 'COP', 'EUR', 'MXN', 'BRL', 'PEN', 'ARS']),
      })
      .strict()
      .parse(body);
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      return tx.paymentOffer.create({ data: { ...data, tenantId: p.tenantId, appId } });
    });
  }
  @Post('checkout')
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  async checkout(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
    @Headers('idempotency-key')
    key: string,
  ) {
    z.string().min(8).max(100).parse(key);
    const data = z
      .object({
        offerId: Id,
        customer: z.object({
          email: z.string().email(),
          name: z.string().min(1).max(100),
          phone: z.string().min(5).max(30),
          document: z.string().min(3).max(30),
        }),
      })
      .strict()
      .parse(body);
    const state = await this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      await tx.$executeRaw`SELECT id FROM "App" WHERE id=${appId}::uuid FOR UPDATE`;
      const offer = await tx.paymentOffer.findFirstOrThrow({
        where: { id: data.offerId, appId, active: true },
      });
      const gateway = await tx.gatewayConfig.findUniqueOrThrow({
        where: {
          tenantId_appId_provider: { tenantId: p.tenantId, appId, provider: offer.provider },
        },
      });
      const existing = await tx.paymentTransaction.findUnique({
        where: {
          tenantId_appId_idempotencyKey: { tenantId: p.tenantId, appId, idempotencyKey: key },
        },
      });
      if (existing) {
        if (existing.offerId !== offer.id)
          throw new BadRequestException('Idempotency key conflict');
        if (existing.checkoutData) return { payment: existing, offer, gateway, cached: true };
        throw new ConflictException(
          'Checkout pending reconciliation; use the same payment reference',
        );
      }
      const payment = await tx.paymentTransaction.create({
        data: {
          tenantId: p.tenantId,
          appId,
          offerId: offer.id,
          provider: offer.provider,
          amountMinor: offer.amountMinor,
          currency: offer.currency,
          idempotencyKey: key,
        },
      });
      return { payment, offer, gateway, cached: false };
    });
    if (state.cached) return { id: state.payment.id, ...(state.payment.checkoutData as object) };
    const credentials = z
      .record(z.string())
      .parse(JSON.parse(this.secrets.resolve(state.gateway.secretRef)));
    let result: CheckoutResult;
    try {
      result = await this.factory.get(state.payment.provider).create(
        {
          id: state.payment.id,
          title: state.offer.title,
          amountMinor: state.offer.amountMinor,
          currency: state.offer.currency,
          returnUrl: process.env.PAYMENT_RETURN_URL!,
          customer: data.customer,
        },
        credentials,
      );
    } catch (error) {
      await this.context.tx((tx) =>
        tx.paymentTransaction.update({
          where: { id: state.payment.id },
          data: { status: 'UNKNOWN' },
        }),
      );
      throw error;
    }
    await this.context.tx(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: state.payment.id },
        data: {
          providerId: result.providerId,
          checkoutUrl: result.url,
          checkoutData: result as unknown as Prisma.InputJsonValue,
        },
      });
      await this.context.audit(tx, 'payment.checkout', state.payment.id);
    });
    return { id: state.payment.id, ...result };
  }
  @Post(':paymentId/reconcile')
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  async reconcile(
    @Param('appId')
    appId: string,
    @Param('paymentId')
    paymentId: string,
    @Body()
    body: unknown,
  ) {
    Id.parse(paymentId);
    const data = z
      .object({
        providerId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .optional(),
      })
      .strict()
      .parse(body);
    const { payment, gateway } = await this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      const payment = await tx.paymentTransaction.findFirstOrThrow({
        where: { id: paymentId, appId },
      });
      const gateway = await tx.gatewayConfig.findUniqueOrThrow({
        where: {
          tenantId_appId_provider: { tenantId: p.tenantId, appId, provider: payment.provider },
        },
      });
      return { payment, gateway };
    });
    if (payment.status === 'PAID') return { status: 'PAID' };
    const id =
      payment.provider === 'wompi' ? data.providerId : (payment.providerId ?? data.providerId);
    if (!id) throw new BadRequestException('Provider transaction ID required');
    const state = await this.factory
      .get(payment.provider)
      .verify(
        payment.id,
        id,
        z.record(z.string()).parse(JSON.parse(this.secrets.resolve(gateway.secretRef))),
      );
    if (!state.paid) return { status: 'PENDING' };
    if (
      state.reference !== payment.id ||
      state.amountMinor !== payment.amountMinor ||
      state.currency !== payment.currency
    )
      throw new BadRequestException('Provider payment does not match this order');
    await this.context.tx(async (tx) => {
      const changed = await tx.paymentTransaction.updateMany({
        where: { id: payment.id, status: { not: 'PAID' } },
        data: { status: 'PAID', providerId: id },
      });
      if (changed.count) {
        await this.workflows.enqueue(tx, appId, 'ON_PAYMENT_SUCCESS', {
          paymentId: payment.id,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        });
        await this.context.audit(tx, 'payment.paid', payment.id);
      }
    });
    return { status: 'PAID' };
  }
}
