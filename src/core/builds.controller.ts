import { Body, Controller, Get, Param, Post, Query, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { TenantContextManager } from '../security/tenant-context.manager';
import { Roles } from '../security/auth';
import { HttpsUrl, Id } from '../contracts/app-config.schema';
@Controller('builds')
export class BuildsController {
  constructor(private readonly context: TenantContextManager) {}
  @Post()
  create(
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({
        appId: Id,
        platform: z.enum(['android', 'ios']),
        assetsUrl: HttpsUrl.optional(),
        assetsSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .refine(
        (v) => !!v.assetsUrl === !!v.assetsSha256,
        'Asset URL and SHA-256 are required together',
      )
      .parse(body);
    const revision = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(process.env.TEMPLATE_REVISION);
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, data.appId);
      const build = await tx.build.create({
        data: { ...data, tenantId: p.tenantId, sourceRevision: revision },
      });
      await this.context.audit(tx, 'build.queued', build.id);
      return build;
    });
  }
  @Get()
  list(
    @Query('appId')
    appId: string,
  ) {
    return this.context.tx(async (tx) => {
      await this.context.app(tx, Id.parse(appId));
      return tx.build.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 50 });
    });
  }
  @Post('claim')
  @Roles('BUILDER')
  claim(
    @Body()
    body: unknown,
  ) {
    const { platform } = z
      .object({ platform: z.enum(['android', 'ios']) })
      .strict()
      .parse(body);
    return this.context.tx(async (tx, p) => {
      await tx.build.updateMany({
        where: { status: 'RUNNING', claimedAt: { lt: new Date(Date.now() - 7200000) } },
        data: { status: 'FAILED' },
      });
      const rows = await tx.$queryRaw<
        {
          id: string;
        }[]
      >`SELECT id FROM "Build" WHERE status='QUEUED' AND platform=${platform} ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const build = await tx.build.update({
        where: { id: rows[0].id },
        data: { status: 'RUNNING', workerSubject: p.subject, claimedAt: new Date() },
      });
      const app = await this.context.app(tx, build.appId);
      return { ...build, appName: app.name, bundleId: app.bundleId, version: app.version };
    });
  }
  @Post(':buildId/status')
  @Roles('BUILDER')
  status(
    @Param('buildId')
    buildId: string,
    @Body()
    body: unknown,
  ) {
    Id.parse(buildId);
    const data = z
      .object({ status: z.enum(['SUCCEEDED', 'FAILED']), artifactUrl: HttpsUrl.optional() })
      .strict()
      .refine(
        (v) => v.status !== 'SUCCEEDED' || !!v.artifactUrl,
        'Successful build requires artifact URL',
      )
      .parse(body);
    return this.context.tx(async (tx, p) => {
      const build = await tx.build.findFirstOrThrow({
        where: { id: buildId, workerSubject: p.subject, status: 'RUNNING' },
      });
      if (data.artifactUrl) {
        const actual = new URL(data.artifactUrl),
          prefix = new URL(process.env.ARTIFACT_PUBLIC_PREFIX!);
        if (
          actual.origin !== prefix.origin ||
          !actual.pathname.startsWith(
            prefix.pathname.replace(/\/$/, '') + '/' + p.tenantId + '/' + buildId + '/',
          )
        )
          throw new BadRequestException('Artifact location not allowed');
      }
      await this.context.audit(tx, 'build.' + data.status.toLowerCase(), build.id);
      return tx.build.update({ where: { id: buildId }, data });
    });
  }
}
