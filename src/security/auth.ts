import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  NestInterceptor,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Observable } from 'rxjs';
import { TenantContextManager, Principal } from './tenant-context.manager';
import { Id } from '../contracts/app-config.schema';
import { RateLimiterService } from './rate-limiter.service';
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
export const ProviderWebhook = () => SetMetadata('providerWebhook', true);
@Injectable()
export class AuthService {
  private jwks = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL!));
  constructor(private readonly context: TenantContextManager) {}
  async verify(token: string): Promise<Principal> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: process.env.OIDC_ISSUER!,
      audience: process.env.OIDC_AUDIENCE!,
      algorithms: ['RS256', 'ES256'],
    });
    const tenantId = Id.parse(payload.tenant_id);
    if (!payload.sub || !payload.exp) throw new UnauthorizedException();
    const principal: Principal = { tenantId, subject: payload.sub, role: 'VIEWER' };
    if (payload.app_id) principal.appId = Id.parse(payload.app_id);
    return this.context.run(principal, () =>
      this.context.tx(async (tx) => {
        const member = await tx.membership.findUnique({
          where: { tenantId_subject: { tenantId, subject: principal.subject } },
        });
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!member || !tenant || !['TRIAL', 'ACTIVE'].includes(tenant.subscriptionStatus))
          throw new UnauthorizedException();
        if (member.role === 'DEVICE' && !principal.appId)
          throw new UnauthorizedException('Device token must be app-scoped');
        return { ...principal, role: member.role };
      }),
    );
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (this.reflector.get<boolean>('providerWebhook', ctx.getHandler())) {
      req.principal = {
        tenantId: Id.parse(req.params.tenantId),
        subject: 'payment-webhook',
        role: 'WEBHOOK',
        appId: Id.parse(req.params.appId),
      };
      await this.limiter.consume(req.principal.tenantId, 'payment-webhook', false);
      return true;
    }
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!bearer) throw new UnauthorizedException();
    try {
      req.principal = await this.auth.verify(bearer[1]);
    } catch {
      throw new UnauthorizedException();
    }
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]) ?? ['OWNER', 'ADMIN'];
    if (!roles.includes(req.principal.role)) throw new ForbiddenException();
    await this.limiter.consume(
      req.principal.tenantId,
      req.principal.subject,
      req.url.includes('/ai/'),
    );
    return true;
  }
}
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly context: TenantContextManager) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    return new Observable((subscriber) => {
      const subscription = this.context.run(ctx.switchToHttp().getRequest().principal, () =>
        next.handle().subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}
