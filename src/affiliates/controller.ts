import { Controller, Get, Param } from '@nestjs/common';
import { TenantContextManager } from '../security/tenant-context.manager';
@Controller('apps/:appId/affiliates')
export class AffiliatesController {
  constructor(private readonly context: TenantContextManager) {}
  @Get()
  summary(@Param('appId') appId: string) {
    return this.context.tx(async (tx, p) => {
      await this.context.app(tx, appId);
      const network = await tx.affiliateNetwork.findUniqueOrThrow({
        where: { tenantId_appId: { tenantId: p.tenantId, appId } },
      });
      return {
        appId,
        name: network.name,
        formVersion: network.formVersion,
        schemaId: network.schemaId,
        fields: network.fields,
        members: await tx.affiliateMember.count({ where: { networkId: network.id } }),
        url: `/affiliates/${p.tenantId}/${appId}/`,
      };
    });
  }
}
