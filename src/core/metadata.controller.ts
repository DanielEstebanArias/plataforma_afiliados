import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetadataService } from './metadata.service';
import { Roles } from '../security/auth';
@Controller('apps/:appId/metadata')
export class MetadataController {
  constructor(private readonly service: MetadataService) {}
  @Get()
  @Roles('OWNER', 'ADMIN', 'VIEWER', 'DEVICE')
  async get(
    @Param('appId')
    appId: string,
    @Headers('if-none-match')
    match: string | undefined,
    @Res()
    res: Response,
  ) {
    const metadata = await this.service.get(appId);
    res.set({
      ETag: metadata.etag,
      'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
      Vary: 'Authorization',
      'Content-Type': 'application/json',
    });
    if (match?.split(',').some((v) => v.trim().replace(/^W\//, '') === metadata.etag))
      res.status(304).end();
    else res.send(metadata.body);
  }
}
