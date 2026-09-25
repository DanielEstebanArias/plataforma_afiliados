import { Injectable, ForbiddenException } from '@nestjs/common';
import { TenantContextManager } from './tenant-context.manager';
import { z } from 'zod';
@Injectable()
export class SecretsService {
  constructor(private readonly context: TenantContextManager) {}
  resolve(ref: string): string {
    z.string()
      .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
      .parse(ref);
    const tenant = this.context.current().tenantId.replace(/-/g, '').toUpperCase();
    const value = process.env['TENANT_' + tenant + '_' + ref];
    if (!value) throw new ForbiddenException('Tenant secret is not provisioned');
    return value;
  }
}
