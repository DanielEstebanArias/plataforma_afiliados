import 'reflect-metadata';
import { Module, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { NestFactory, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import helmet from 'helmet';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { AffiliatesController } from './affiliates/controller';
import { mountAffiliates } from './affiliates/middleware';
import { TenantContextManager } from './security/tenant-context.manager';
import { AuthService, AuthGuard, TenantInterceptor } from './security/auth';
import { SecretsService } from './security/secrets.service';
import { AIAgentService, ModelFactory } from './ai/ai-agent.service';
import { AIAgentController } from './ai/ai-agent.controller';
import { MetadataService } from './core/metadata.service';
import { MetadataController } from './core/metadata.controller';
import { RealtimeGateway } from './core/realtime.gateway';
import { WorkflowEngineService } from './core/workflow-engine.service';
import { AppsController } from './core/apps.controller';
import { PaymentStrategyFactory } from './payments/payments.strategy';
import { PaymentsController } from './payments/payments.controller';
import { GISController } from './core/gis.controller';
import { GISGateway } from './core/gis.gateway';
import { BuildsController } from './core/builds.controller';
import { AssetsController } from './core/assets.controller';
import { RateLimiterService } from './security/rate-limiter.service';
import { PaymentEventsController } from './payments/payment-events.controller';
import { MqttIngestService } from './core/mqtt-ingest.service';
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof ZodError)
      return response.status(400).json({ error: 'Validation failed', issues: error.issues });
    if (error instanceof HttpException)
      return response.status(error.getStatus()).json({ error: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      return response
        .status(error.code === 'P2002' ? 409 : 400)
        .json({ error: 'Resource conflict or unavailable' });
    console.error('Request failed:', error instanceof Error ? error.name : 'Unknown');
    response.status(500).json({ error: 'Internal server error' });
  }
}
@Module({
  controllers: [
    AffiliatesController,
    AIAgentController,
    MetadataController,
    AppsController,
    PaymentsController,
    PaymentEventsController,
    GISController,
    BuildsController,
    AssetsController,
  ],
  providers: [
    TenantContextManager,
    AuthService,
    SecretsService,
    RateLimiterService,
    AIAgentService,
    ModelFactory,
    MetadataService,
    RealtimeGateway,
    WorkflowEngineService,
    PaymentStrategyFactory,
    PaymentsController,
    GISController,
    GISGateway,
    MqttIngestService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
class AppModule {}
async function bootstrap() {
  z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    OIDC_JWKS_URL: z.string().url(),
    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    PORTAL_ORIGIN: z.string().url(),
    PAYMENT_RETURN_URL: z.string().url(),
  })
    .passthrough()
    .parse(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  const affiliatesDb = new PrismaClient();
  mountAffiliates(app, affiliatesDb);
  app.useBodyParser('json', { limit: '2mb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'connect-src': [
            "'self'",
            new URL(process.env.OIDC_TOKEN_URL ?? process.env.OIDC_ISSUER!).origin,
          ],
          'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
          'form-action': ["'self'"],
        },
      },
    }),
  );
  app.enableCors({
    origin: process.env.PORTAL_ORIGIN,
    credentials: false,
    exposedHeaders: ['ETag'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  app.use('/auth-config', (_req: any, res: any) =>
    res.json({
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      authorizationUrl: process.env.OIDC_AUTHORIZATION_URL,
      tokenUrl: process.env.OIDC_TOKEN_URL,
      audience: process.env.OIDC_AUDIENCE,
    }),
  );
  app.useStaticAssets(path.resolve('portal'), { prefix: '/' });
  const pub = new Redis(process.env.REDIS_URL!),
    sub = pub.duplicate();
  class RedisAdapter extends IoAdapter {
    createIOServer(port: number, options?: any) {
      const server = super.createIOServer(port, options);
      server.adapter(createAdapter(pub, sub));
      return server;
    }
  }
  app.useWebSocketAdapter(new RedisAdapter(app));
  const close = app.close.bind(app);
  app.close = async () => {
    await affiliatesDb.$disconnect();
    pub.disconnect();
    sub.disconnect();
    await close();
  };
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
