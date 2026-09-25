import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TenantContextManager } from '../security/tenant-context.manager';
import { Roles } from '../security/auth';
import { WorkflowEngineService } from './workflow-engine.service';
export const PositionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    capturedAt: z.string().datetime(),
    deviceId: z.string().min(1).max(100),
  })
  .strict();
@Controller('apps/:appId/gis')
export class GISController {
  constructor(
    private readonly context: TenantContextManager,
    private readonly workflows: WorkflowEngineService,
  ) {}
  @Post('positions')
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  position(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = PositionSchema.parse(body);
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "GeoPosition" (id,"tenantId","appId","deviceId",point,"capturedAt") VALUES (${id}::uuid,${p.tenantId}::uuid,${appId}::uuid,${p.subject + ':' + data.deviceId},ST_SetSRID(ST_MakePoint(${data.longitude},${data.latitude}),4326)::geography,${new Date(data.capturedAt)})`;
      return { id };
    });
  }
  @Post('geofence')
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  geofence(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({ id: z.string().max(100), position: PositionSchema })
      .strict()
      .parse(body);
    return this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      return this.workflows.enqueue(tx, appId, 'ON_GEOFENCE_ENTER', data);
    });
  }
}
