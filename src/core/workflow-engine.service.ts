import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { TenantContextManager } from '../security/tenant-context.manager';
import { SecretsService } from '../security/secrets.service';
import { WorkflowActionSchema } from '../contracts/app-config.schema';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { applicationDefault, initializeApp, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { approvedFetch } from './outbound';
import { Prisma } from '@prisma/client';
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
@Injectable()
export class WorkflowEngineService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private log = new Logger('WorkflowEngine');
  constructor(
    private readonly context: TenantContextManager,
    private readonly secrets: SecretsService,
  ) {}
  onModuleInit() {
    if (process.env.WORKER_TENANTS) this.timer = setInterval(() => void this.tick(), 2000);
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }
  async enqueue(
    tx: Prisma.TransactionClient,
    appId: string,
    trigger: string,
    payload: Prisma.InputJsonValue,
  ) {
    return tx.workflowEvent.create({
      data: { tenantId: this.context.current().tenantId, appId, trigger, payload },
    });
  }
  private async tick() {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      for (const tenantId of (process.env.WORKER_TENANTS ?? '').split(',').filter(Boolean)) {
        await this.context
          .run({ tenantId, subject: 'workflow-worker', role: 'SERVICE' }, () => this.processNext())
          .catch(() => this.log.error('Workflow failed; retained for retry'));
      }
    } finally {
      this.running = false;
    }
  }
  async processNext() {
    const event = await this.context.tx(async (tx) => {
      await tx.workflowEvent.updateMany({
        where: { status: 'RUNNING', attempts: { gte: 8 }, availableAt: { lt: new Date() } },
        data: { status: 'FAILED' },
      });
      const rows = await tx.$queryRaw<
        {
          id: string;
        }[]
      >`SELECT id FROM "WorkflowEvent" WHERE status IN ('PENDING','RUNNING') AND "availableAt"<now() AND attempts<8 ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      return tx.workflowEvent.update({
        where: { id: rows[0].id },
        data: {
          status: 'RUNNING',
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + 300000),
        },
      });
    });
    if (!event) return;
    try {
      const workflows = await this.context.tx((tx) =>
        tx.workflow.findMany({
          where: { appId: event.appId, trigger: event.trigger, enabled: true },
          orderBy: { id: 'asc' },
        }),
      );
      for (const workflow of workflows) {
        const actions = z.array(WorkflowActionSchema).max(20).parse(workflow.actions);
        for (let index = 0; index < actions.length; index++) {
          const key = workflow.id + ':' + index;
          const done = await this.context.tx((tx, p) =>
            tx.workflowStep.findUnique({
              where: { tenantId_eventId_key: { tenantId: p.tenantId, eventId: event.id, key } },
            }),
          );
          if (done) continue;
          const result = await this.execute(actions[index], event.payload, event.id + ':' + key);
          await this.context.tx((tx, p) =>
            tx.workflowStep.create({
              data: { tenantId: p.tenantId, eventId: event.id, key, result },
            }),
          );
        }
      }
      await this.context.tx((tx) =>
        tx.workflowEvent.update({ where: { id: event.id }, data: { status: 'DONE' } }),
      );
    } catch (error) {
      await this.context.tx((tx) =>
        tx.workflowEvent.update({
          where: { id: event.id },
          data: {
            status: event.attempts >= 8 ? 'FAILED' : 'PENDING',
            availableAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** event.attempts)),
          },
        }),
      );
      throw error;
    }
  }
  private async execute(
    action: z.infer<typeof WorkflowActionSchema>,
    payload: Prisma.JsonValue,
    key: string,
  ): Promise<Prisma.InputJsonValue> {
    if (action.type === 'WEBHOOK') {
      const body = JSON.stringify({ eventId: key, payload }),
        timestamp = Math.floor(Date.now() / 1000).toString();
      await approvedFetch(action.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-timestamp': timestamp,
          'x-signature': createHmac('sha256', this.secrets.resolve(action.secretRef))
            .update(timestamp + '.' + body)
            .digest('hex'),
        },
        body,
      });
      return { delivered: true };
    }
    if (action.type === 'PUSH') {
      const tenantId = this.context.current().tenantId;
      const name = 'tenant-' + tenantId;
      const app =
        getApps().find((a) => a.name === name) ??
        initializeApp({ credential: applicationDefault() }, name);
      const messageId = await getMessaging(app).send({
        token: action.token,
        notification: { title: action.title, body: action.body },
        data: { eventId: key },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      return { messageId };
    }
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => void req.abort());
      await page.setContent(
        '<!doctype html><meta charset="utf-8"><style>body{font:14px sans-serif;padding:40px}pre{white-space:pre-wrap}</style><h1>' +
          escapeHtml(action.title) +
          '</h1><pre>' +
          escapeHtml(action.text) +
          '</pre>',
      );
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      const tenant = this.context.current().tenantId;
      const dir = path.resolve(process.env.ARTIFACT_DIR ?? 'artifacts', tenant);
      await mkdir(dir, { recursive: true });
      const filename = key.replace(/:/g, '_') + '.pdf';
      await writeFile(path.join(dir, filename), pdf);
      return { artifact: tenant + '/' + filename };
    } finally {
      await browser.close();
    }
  }
}
