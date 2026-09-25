import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { TenantContextManager } from '../security/tenant-context.manager';
import { AppConfigSchema } from '../contracts/app-config.schema';
@Injectable()
export class MetadataService implements OnModuleDestroy {
  private redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, lazyConnect: true });
  constructor(private readonly context: TenantContextManager) {}
  async onModuleDestroy() {
    this.redis.disconnect();
  }
  async get(appId: string) {
    const app = await this.context.tx((tx) => this.context.app(tx, appId));
    const key = `metadata:${app.tenantId}:${appId}:${app.revision}`;
    let body: string | null = null;
    try {
      body = await this.redis.get(key);
    } catch {}
    if (!body) {
      body = await this.context.tx(async (tx) => {
        const current = await this.context.app(tx, appId);
        const screens = await tx.screen.findMany({
          where: { appId },
          orderBy: { route: 'asc' },
          select: { route: true, title: true, tree: true },
        });
        const gateways = await tx.gatewayConfig.findMany({
          where: { appId },
          select: { provider: true, publicConfig: true },
        });
        return JSON.stringify(
          AppConfigSchema.parse({
            schemaVersion: '1.0',
            appId,
            revision: current.revision,
            version: current.version,
            theme: current.theme,
            screens,
            gateways,
          }),
        );
      });
      const revision = (
        JSON.parse(body) as {
          revision: number;
        }
      ).revision;
      try {
        await this.redis.set(`metadata:${app.tenantId}:${appId}:${revision}`, body, 'EX', 300);
      } catch {}
    }
    return { body, etag: '"' + createHash('sha256').update(body).digest('hex') + '"' };
  }
}
