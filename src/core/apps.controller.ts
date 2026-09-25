import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Headers,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantContextManager } from '../security/tenant-context.manager';
import { AIAgentService } from '../ai/ai-agent.service';
import { WorkflowEngineService } from './workflow-engine.service';
import {
  Id,
  Name,
  FieldSchema,
  validateRecord,
  Trigger,
  WorkflowActionSchema,
  ThemeSchema,
} from '../contracts/app-config.schema';
import { RealtimeGateway } from './realtime.gateway';
import { Roles } from '../security/auth';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
@Controller('apps')
export class AppsController {
  constructor(
    private readonly context: TenantContextManager,
    private readonly ai: AIAgentService,
    private readonly workflows: WorkflowEngineService,
    private readonly realtime: RealtimeGateway,
  ) {}
  @Patch(':appId')
  async update(@Param('appId') appId: string, @Body() body: unknown) {
    const data = z
      .object({
        name: z.string().min(1).max(100).optional(),
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+$/)
          .optional(),
        theme: ThemeSchema.optional(),
      })
      .strict()
      .parse(body);
    const app = await this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      const result = await tx.app.update({
        where: { id: appId },
        data: { ...data, revision: { increment: 1 } },
      });
      await this.context.audit(tx, 'app.updated', appId);
      return result;
    });
    this.realtime.changed(app.id, app.revision);
    return app;
  }
  @Get()
  list() {
    return this.context.tx((tx) => tx.app.findMany({ orderBy: { createdAt: 'desc' }, include: { affiliateNetwork: { select: { id: true, formVersion: true } } } }));
  }
  @Post()
  create(
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({
        name: z.string().min(1).max(100),
        bundleId: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/),
      })
      .strict()
      .parse(body);
    return this.context.tx(async (tx, p) => {
      await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR UPDATE`;
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: p.tenantId } });
      const quota = z.object({ apps: z.number() }).passthrough().parse(tenant.quotas).apps;
      if ((await tx.app.count()) >= quota) throw new BadRequestException('App quota exhausted');
      const app = await tx.app.create({
        data: { ...data, tenantId: p.tenantId, workspace: { create: {} } },
      });
      await this.context.audit(tx, 'app.created', app.id);
      return app;
    });
  }
  @Post(':appId/screens')
  screen(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    return this.ai.execute(Id.parse(appId), 'createScreenFromPrompt', body);
  }
  @Post(':appId/schemas')
  schema(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    return this.ai.execute(Id.parse(appId), 'buildDatabaseTable', body);
  }
  @Post(':appId/gateways')
  gateway(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    return this.ai.execute(Id.parse(appId), 'configurePaymentGateway', body);
  }
  @Get(':appId/schemas')
  schemas(
    @Param('appId')
    appId: string,
  ) {
    return this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      return tx.dynamicSchema.findMany({ where: { appId } });
    });
  }
  @Post(':appId/workflows')
  workflow(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({
        name: Name,
        trigger: Trigger,
        actions: z.array(WorkflowActionSchema).min(1).max(20),
      })
      .strict()
      .parse(body);
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      return tx.workflow.create({
        data: {
          ...data,
          tenantId: p.tenantId,
          appId,
          actions: data.actions as Prisma.InputJsonValue,
        },
      });
    });
  }
  @Post(':appId/records/:schemaId')
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  submit(
    @Param('appId')
    appId: string,
    @Param('schemaId')
    schemaId: string,
    @Headers('idempotency-key')
    key: string,
    @Body()
    body: unknown,
  ) {
    Id.parse(schemaId);
    z.string().min(8).max(100).parse(key);
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR UPDATE`;
      const schema = await tx.dynamicSchema.findFirstOrThrow({ where: { id: schemaId, appId } });
      const fields = z.array(FieldSchema).parse(schema.fields);
      const validated = validateRecord(fields, body);
      for (const field of fields) {
        const value = validated[field.name];
        if (!value) continue;
        if (field.type === 'file') {
          const asset = await tx.asset.findFirst({
            where: { id: value.assetId, appId, sha256: value.sha256 },
          });
          if (!asset) throw new BadRequestException('Asset does not belong to this app');
        }
        if (
          field.type === 'signature' &&
          createHash('sha256').update(value.svg).digest('hex') !== value.sha256
        )
          throw new BadRequestException('Signature hash mismatch');
      }
      const data = validated as Prisma.InputJsonValue;
      const existing = await tx.dynamicRecord.findUnique({
        where: {
          tenantId_schemaId_idempotencyKey: { tenantId: p.tenantId, schemaId, idempotencyKey: key },
        },
      });
      if (existing) {
        if (!isDeepStrictEqual(existing.data, data))
          throw new BadRequestException('Idempotency key reused with different input');
        return existing;
      }
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: p.tenantId } });
      const quota = z.object({ records: z.number() }).passthrough().parse(tenant.quotas).records;
      if ((await tx.dynamicRecord.count()) >= quota)
        throw new BadRequestException('Record quota exhausted');
      const record = await tx.dynamicRecord.create({
        data: { tenantId: p.tenantId, schemaId, data, idempotencyKey: key },
      });
      await this.workflows.enqueue(tx, appId, 'ON_FORM_SUBMIT', {
        recordId: record.id,
        schemaId,
        data,
      });
      return record;
    });
  }
  @Get(':appId/records/:schemaId')
  @Roles('OWNER', 'ADMIN', 'VIEWER', 'DEVICE')
  records(
    @Param('appId')
    appId: string,
    @Param('schemaId')
    schemaId: string,
    @Query('cursor')
    cursor?: string,
  ) {
    Id.parse(schemaId);
    if (cursor) Id.parse(cursor);
    return this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      await tx.dynamicSchema.findFirstOrThrow({ where: { appId, id: schemaId } });
      const items = await tx.dynamicRecord.findMany({
        where: { schemaId },
        orderBy: { id: 'asc' },
        take: 50,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return { items, nextCursor: items.length === 50 ? items.at(-1)!.id : null };
    });
  }
}
