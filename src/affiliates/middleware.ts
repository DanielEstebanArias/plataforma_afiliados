import { PrismaClient } from '@prisma/client';
import { AffiliatesStore } from './store';
import path from 'node:path';
const { createApp } = require(path.resolve('affiliates/server.cjs'));
export function affiliatesHandler(prisma: PrismaClient, tenantId: string, appId: string) {
  const store = new AffiliatesStore(prisma, tenantId, appId);
  return createApp(store).server.listeners('request')[0];
}
/** Mounted before body parsing: the member module authenticates its own app-scoped sessions. */
export function mountAffiliates(app: any, prisma: PrismaClient) {
  const handlers = new Map<string, any>();
  app.use('/affiliates/:tenantId/:appId', async (req: any, res: any) => {
    const { tenantId, appId } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[0-9a-f-]{36}$/.test(appId))
      return res.status(404).end();
    if (req.originalUrl.split('?')[0] === req.baseUrl) return res.redirect(308, req.baseUrl + '/');
    const key = tenantId + ':' + appId;
    try {
      if (!handlers.has(key)) {
        const store = new AffiliatesStore(prisma, tenantId, appId);
        await store.tx(async () => true);
        handlers.set(key, createApp(store).server.listeners('request')[0]);
      }
      return handlers.get(key)(req, res);
    } catch {
      return res.status(404).json({ error: 'Aplicación no disponible.' });
    }
  });
}
