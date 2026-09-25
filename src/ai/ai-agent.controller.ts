import { Body, Controller, Param, Post, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AIAgentService } from './ai-agent.service';
import { Id } from '../contracts/app-config.schema';
import { TenantContextManager } from '../security/tenant-context.manager';
import { Prisma } from '@prisma/client';
@Controller('apps/:appId/ai')
export class AIAgentController {
  constructor(
    private readonly service: AIAgentService,
    private readonly context: TenantContextManager,
  ) {}
  @Post('prompt')
  prompt(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    return this.service.prompt(
      Id.parse(appId),
      z
        .object({ prompt: z.string().min(1).max(12000) })
        .strict()
        .parse(body).prompt,
    );
  }
  @Post('knowledge')
  ingest(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({ source: z.string().max(200), content: z.string().min(1).max(100000) })
      .strict()
      .parse(body);
    return this.service.ingest(Id.parse(appId), data.source, data.content);
  }
  @Patch('workspace')
  configure(
    @Param('appId')
    appId: string,
    @Body()
    body: unknown,
  ) {
    const data = z
      .object({
        systemPrompt: z.string().min(1).max(8000).optional(),
        longTermMemory: z
          .record(z.string().max(1000))
          .refine((v) => JSON.stringify(v).length < 12000)
          .optional(),
        provider: z.string().max(50).optional(),
        model: z.string().max(100).optional(),
        secretRef: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
          .optional(),
      })
      .strict()
      .parse(body);
    return this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      const updated = await tx.aIAgentWorkspace.update({
        where: { appId },
        data: { ...data, longTermMemory: data.longTermMemory as Prisma.InputJsonValue | undefined },
      });
      await this.context.audit(tx, 'ai.workspace.updated', updated.id);
      return { id: updated.id, model: updated.model, provider: updated.provider };
    });
  }
}
