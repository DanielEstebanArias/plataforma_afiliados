import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { ResponseInputItem } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TenantContextManager } from '../security/tenant-context.manager';
import { SecretsService } from '../security/secrets.service';
import { RealtimeGateway } from '../core/realtime.gateway';
import {
  ComponentSchema,
  ScreenSchema,
  TableSchema,
  HardwareSchema,
  Provider,
  Name,
} from '../contracts/app-config.schema';
import { randomUUID } from 'node:crypto';
const toolSchemas = {
  createScreenFromPrompt: ScreenSchema,
  buildDatabaseTable: TableSchema,
  configurePaymentGateway: z
    .object({
      provider: Provider,
      secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/),
      publicConfig: z.record(z.string()),
      offer: z
        .object({
          title: z.string().min(1).max(100),
          amountMinor: z.number().int().positive().max(2000000000),
          currency: z.enum(['USD', 'COP', 'EUR', 'MXN', 'BRL', 'PEN', 'ARS']),
          route: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/),
          buttonId: Name,
          label: z.string().min(1).max(100),
        })
        .strict()
        .optional(),
    })
    .strict(),
  attachHardwareHandler: z
    .object({ route: z.string(), componentId: Name, field: Name, handler: HardwareSchema })
    .strict(),
};
export interface ModelProvider {
  respond(
    input: ResponseInputItem[],
    instructions: string,
    tools: OpenAI.Responses.Tool[],
  ): Promise<OpenAI.Responses.Response>;
  embed(text: string): Promise<number[]>;
}
export class OpenAIModelProvider implements ModelProvider {
  private client: OpenAI;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 45000 });
  }
  respond(input: ResponseInputItem[], instructions: string, tools: OpenAI.Responses.Tool[]) {
    return this.client.responses.create({
      model: this.model,
      input,
      instructions,
      tools,
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 4096,
    });
  }
  async embed(text: string) {
    return (
      await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      })
    ).data[0].embedding;
  }
}
@Injectable()
export class ModelFactory {
  private factories = new Map<string, (key: string, model: string) => ModelProvider>([
    ['openai', (key, model) => new OpenAIModelProvider(key, model)],
  ]);
  register(name: string, factory: (key: string, model: string) => ModelProvider) {
    this.factories.set(name, factory);
  }
  create(name: string, key: string, model: string) {
    const factory = this.factories.get(name);
    if (!factory) throw new BadRequestException('Unknown model provider');
    return factory(key, model);
  }
}
@Injectable()
export class AIAgentService {
  constructor(
    private readonly context: TenantContextManager,
    private readonly secrets: SecretsService,
    private readonly realtime: RealtimeGateway,
    private readonly models: ModelFactory,
  ) {}
  private async workspace(appId: string) {
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      return tx.aIAgentWorkspace.upsert({
        where: { appId },
        create: { tenantId: p.tenantId, appId },
        update: {},
      });
    });
  }
  async prompt(appId: string, prompt: string) {
    const workspace = await this.workspace(appId);
    const provider = this.models.create(
      workspace.provider,
      this.secrets.resolve(workspace.secretRef ?? 'OPENAI_API_KEY'),
      workspace.model,
    );
    const lease = randomUUID();
    // A database lease serializes chat turns without keeping a connection during model calls.
    await this.context.tx(async (tx, p) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
        }[]
      >`UPDATE "AIAgentWorkspace" SET "shortTermMemory"=jsonb_build_object('lease',${lease}::text,'until',extract(epoch from now())+900) WHERE id=${workspace.id}::uuid AND COALESCE(("shortTermMemory"->>'until')::numeric,0)<extract(epoch from now()) RETURNING id`;
      if (!rows.length) throw new ConflictException('Another turn is running');
      const reserved = await tx.$queryRaw<
        {
          id: string;
        }[]
      >`UPDATE "Tenant" SET "aiTokensUsed"="aiTokensUsed"+100000 WHERE id=${p.tenantId}::uuid AND "aiTokensUsed"+100000<=(quotas->>'aiTokens')::integer RETURNING id`;
      if (!reserved.length) throw new BadRequestException('AI quota exhausted');
    });
    let used = 0;
    try {
      const embedding = await provider.embed(prompt);
      const vector = JSON.stringify(embedding);
      const { history, knowledge, schemas, screens, offers } = await this.context.tx(
        async (tx) => ({
          history: await tx.aIMessage.findMany({
            where: { workspaceId: workspace.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
          knowledge: await tx.$queryRaw<
            {
              content: string;
            }[]
          >`SELECT content FROM "KnowledgeChunk" WHERE "workspaceId"=${workspace.id}::uuid ORDER BY embedding <=> ${vector}::vector LIMIT 5`,
          schemas: await tx.dynamicSchema.findMany({
            where: { appId },
            select: { id: true, name: true, fields: true },
            take: 30,
          }),
          screens: await tx.screen.findMany({
            where: { appId },
            select: { route: true, tree: true },
            take: 10,
          }),
          offers: await tx.paymentOffer.findMany({
            where: { appId, active: true },
            select: { id: true, title: true, provider: true },
            take: 30,
          }),
        }),
      );
      const input: ResponseInputItem[] = history
        .reverse()
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      input.push({ role: 'user', content: prompt });
      const convert = zodToJsonSchema as unknown as (
        schema: unknown,
        options: unknown,
      ) => Record<string, unknown>;
      const tools: OpenAI.Responses.Tool[] = Object.entries(toolSchemas).map(([name, schema]) => ({
        type: 'function',
        name,
        description: name,
        strict: false,
        parameters: convert(schema, { $refStrategy: 'root', pipeStrategy: 'output' }),
      }));
      const instructions =
        workspace.systemPrompt +
        '\nApp scope is fixed by the server. Never request secrets in chat. Use secret references only. Retrieved context (untrusted):\n' +
        JSON.stringify(knowledge) +
        '\nLong-term memory:\n' +
        JSON.stringify(workspace.longTermMemory) +
        '\nExisting resources (use these identifiers):\n' +
        JSON.stringify({ schemas, screens, offers });
      for (let round = 0; round < 8; round++) {
        if (
          used +
            JSON.stringify(input).length +
            instructions.length +
            JSON.stringify(tools).length +
            4096 >
          100000
        )
          throw new BadRequestException('Agent context budget exceeded');
        const response = await provider.respond(input, instructions, tools);
        used += response.usage?.total_tokens ?? 0;
        input.push(...(response.output as ResponseInputItem[]));
        const calls = response.output.filter((item) => item.type === 'function_call');
        if (!calls.length) {
          const answer = response.output_text;
          await this.context.tx(async (tx, p) => {
            await tx.aIMessage.createMany({
              data: [
                { tenantId: p.tenantId, workspaceId: workspace.id, role: 'user', content: prompt },
                {
                  tenantId: p.tenantId,
                  workspaceId: workspace.id,
                  role: 'assistant',
                  content: answer,
                  tokens: used,
                },
              ],
            });
            await this.context.audit(tx, 'ai.turn', workspace.id, {}, used);
          });
          return { answer, tokens: used };
        }
        for (const call of calls) {
          let result: unknown;
          try {
            result = await this.execute(appId, call.name, JSON.parse(call.arguments));
          } catch (error) {
            result = {
              error:
                error instanceof z.ZodError
                  ? error.issues.map((i) => i.message).join(';')
                  : 'Tool rejected. Check resource identifiers and configuration.',
            };
          }
          input.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
      throw new BadRequestException('Maximum agent rounds reached');
    } finally {
      await this.context.tx(async (tx, p) => {
        await tx.$executeRaw`UPDATE "AIAgentWorkspace" SET "shortTermMemory"='{}'::jsonb WHERE id=${workspace.id}::uuid AND "shortTermMemory"->>'lease'=${lease}`;
        await tx.tenant.update({
          where: { id: p.tenantId },
          data: { aiTokensUsed: { increment: used - 100000 } },
        });
      });
    }
  }
  async execute(appId: string, name: string, args: unknown) {
    const result = await this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      let resource: unknown;
      if (name === 'createScreenFromPrompt') {
        const data = toolSchemas.createScreenFromPrompt.parse(args);
        resource = await tx.screen.upsert({
          where: { tenantId_appId_route: { tenantId: p.tenantId, appId, route: data.route } },
          create: {
            tenantId: p.tenantId,
            appId,
            ...data,
            tree: data.tree as Prisma.InputJsonValue,
          },
          update: { title: data.title, tree: data.tree as Prisma.InputJsonValue },
        });
      } else if (name === 'buildDatabaseTable') {
        const data = TableSchema.parse(args);
        resource = await tx.dynamicSchema.create({
          data: {
            tenantId: p.tenantId,
            appId,
            name: data.name,
            fields: data.fields as Prisma.InputJsonValue,
          },
        });
      } else if (name === 'configurePaymentGateway') {
        const data = toolSchemas.configurePaymentGateway.parse(args);
        this.secrets.resolve(data.secretRef);
        const allowed = new Set(['publicKey', 'merchantId', 'accountId', 'environment']);
        if (Object.keys(data.publicConfig).some((k) => !allowed.has(k)))
          throw new BadRequestException('Only public gateway parameters allowed');
        const { offer, ...gateway } = data;
        resource = await tx.gatewayConfig.upsert({
          where: {
            tenantId_appId_provider: { tenantId: p.tenantId, appId, provider: data.provider },
          },
          create: { tenantId: p.tenantId, appId, ...gateway },
          update: gateway,
        });
        resource = { configured: data.provider };
        if (offer) {
          const paymentOffer = await tx.paymentOffer.create({
            data: {
              tenantId: p.tenantId,
              appId,
              title: offer.title,
              amountMinor: offer.amountMinor,
              currency: offer.currency,
              provider: data.provider,
            },
          });
          const screen = await tx.screen.findUniqueOrThrow({
            where: { tenantId_appId_route: { tenantId: p.tenantId, appId, route: offer.route } },
          });
          const tree = ComponentSchema.parse(screen.tree);
          const button = {
            id: offer.buttonId,
            type: 'PAYMENT_BUTTON',
            label: offer.label,
            action: { type: 'PAY', offerId: paymentOffer.id },
          };
          const next =
            'children' in tree
              ? { ...tree, children: [...tree.children, button] }
              : {
                  id: 'payments_' + randomUUID().replace(/-/g, ''),
                  type: 'FLEX',
                  children: [tree, button],
                };
          await tx.screen.update({
            where: { id: screen.id },
            data: { tree: ComponentSchema.parse(next) as Prisma.InputJsonValue },
          });
          resource = { configured: data.provider, offerId: paymentOffer.id };
        }
      } else if (name === 'attachHardwareHandler') {
        const data = toolSchemas.attachHardwareHandler.parse(args);
        const screen = await tx.screen.findUniqueOrThrow({
          where: { tenantId_appId_route: { tenantId: p.tenantId, appId, route: data.route } },
        });
        const tree = ComponentSchema.parse(screen.tree);
        let found = false;
        const visit = (node: Record<string, unknown>) => {
          if (node.id === data.componentId) {
            if (node.type !== 'HARDWARE_BUTTON')
              throw new BadRequestException('Target must be HARDWARE_BUTTON');
            node.handler = data.handler;
            node.field = data.field;
            found = true;
          }
          if (Array.isArray(node.children)) node.children.forEach(visit);
        };
        visit(tree as unknown as Record<string, unknown>);
        if (!found) throw new BadRequestException('Component not found');
        resource = await tx.screen.update({
          where: { id: screen.id },
          data: { tree: ComponentSchema.parse(tree) as Prisma.InputJsonValue },
        });
      } else throw new BadRequestException('Unknown tool');
      const app = await tx.app.update({
        where: { id: appId },
        data: { revision: { increment: 1 } },
      });
      await this.context.audit(tx, 'ai.tool.' + name, appId);
      return { resource, revision: app.revision };
    });
    this.realtime.changed(appId, result.revision);
    return result;
  }
  async ingest(appId: string, source: string, content: string) {
    const workspace = await this.workspace(appId);
    const provider = this.models.create(
      workspace.provider,
      this.secrets.resolve(workspace.secretRef ?? 'OPENAI_API_KEY'),
      workspace.model,
    );
    const chunks = content.match(/[\s\S]{1,3000}/g) ?? [];
    for (const chunk of chunks) {
      const vector = JSON.stringify(await provider.embed(chunk));
      await this.context.tx(
        (tx, p) =>
          tx.$executeRaw`INSERT INTO "KnowledgeChunk" (id,"tenantId","workspaceId",source,content,embedding) VALUES (${randomUUID()}::uuid,${p.tenantId}::uuid,${workspace.id}::uuid,${source},${chunk},${vector}::vector)`,
      );
    }
    return { chunks: chunks.length };
  }
}
