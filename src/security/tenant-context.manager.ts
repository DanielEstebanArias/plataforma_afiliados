import { Injectable, ForbiddenException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Id } from '../contracts/app-config.schema';
export type Principal = {
  tenantId: string;
  subject: string;
  role: string;
  appId?: string;
};
@Injectable()
export class TenantContextManager implements OnModuleInit, OnModuleDestroy {
  private readonly storage = new AsyncLocalStorage<Principal>();
  private readonly db = new PrismaClient();
  async onModuleInit() {
    await this.db.$connect();
    const roles = await this.db.$queryRaw<
      {
        rolsuper: boolean;
        rolbypassrls: boolean;
      }[]
    >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    if (!roles.length || roles[0].rolsuper || roles[0].rolbypassrls)
      throw new Error('Runtime database role must enforce RLS');
    const unsafe = await this.db.$queryRaw<
      {
        tablename: string;
      }[]
    >`SELECT c.relname AS tablename FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`;
    if (unsafe.length) throw new Error('RLS missing: ' + unsafe.map((x) => x.tablename).join(','));
  }
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
  current() {
    const p = this.storage.getStore();
    if (!p) throw new ForbiddenException('Missing tenant context');
    return p;
  }
  run<T>(principal: Principal, fn: () => T): T {
    Id.parse(principal.tenantId);
    return this.storage.run(Object.freeze({ ...principal }), fn);
  }
  async tx<T>(fn: (tx: Prisma.TransactionClient, p: Principal) => Promise<T>): Promise<T> {
    const p = this.current();
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${p.tenantId},true)`;
        return fn(tx, p);
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }
  async app(tx: Prisma.TransactionClient, appId: string) {
    Id.parse(appId);
    const p = this.current();
    if (p.appId && p.appId !== appId) throw new ForbiddenException('App access denied');
    const app = await tx.app.findUnique({
      where: { tenantId_id: { tenantId: p.tenantId, id: appId } },
    });
    if (!app) throw new ForbiddenException('App access denied');
    return app;
  }
  async audit(
    tx: Prisma.TransactionClient,
    action: string,
    resourceId: string,
    details: Prisma.InputJsonValue = {},
    tokens = 0,
  ) {
    const p = this.current();
    return tx.auditLog.create({
      data: {
        tenantId: p.tenantId,
        actor: p.subject,
        action,
        resourceId,
        details,
        aiTokens: tokens,
      },
    });
  }
}
