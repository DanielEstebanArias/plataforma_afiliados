import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  Headers,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { TenantContextManager } from '../security/tenant-context.manager';
import { Roles } from '../security/auth';
import { Id } from '../contracts/app-config.schema';
@Controller('apps/:appId/assets')
export class AssetsController {
  constructor(private readonly context: TenantContextManager) {}
  @Post()
  @Roles('OWNER', 'ADMIN', 'DEVICE')
  async upload(
    @Param('appId')
    appId: string,
    @Headers('idempotency-key')
    id: string,
    @Headers('content-type')
    type: string,
    @Req()
    req: Request,
  ) {
    Id.parse(id);
    const contentType = z
      .enum(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'audio/mp4'])
      .parse(type);
    const existing = await this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      return tx.asset.findFirst({ where: { id, appId } });
    });
    if (existing) {
      req.resume();
      return { assetId: existing.id, sha256: existing.sha256 };
    }
    const tenant = this.context.current().tenantId;
    const storageKey = tenant + '/' + appId + '/' + randomUUID();
    const filename = path.resolve(process.env.ARTIFACT_DIR ?? 'artifacts', storageKey);
    await mkdir(path.dirname(filename), { recursive: true });
    let bytes = 0;
    const hash = createHash('sha256');
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > 100 * 1024 * 1024) return callback(new PayloadTooLargeException());
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(req, limiter, createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
      const digest = hash.digest('hex');
      await this.context.tx((tx, p) =>
        tx.asset.create({
          data: { id, tenantId: p.tenantId, appId, contentType, bytes, sha256: digest, storageKey },
        }),
      );
      return { assetId: id, sha256: digest };
    } catch (error) {
      await unlink(filename).catch(() => {});
      throw error;
    }
  }
  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'DEVICE', 'VIEWER')
  async download(
    @Param('appId')
    appId: string,
    @Param('id')
    id: string,
    @Res()
    res: Response,
  ) {
    Id.parse(id);
    const asset = await this.context.tx(async (tx) => {
      await this.context.app(tx, appId);
      return tx.asset.findFirstOrThrow({ where: { id, appId } });
    });
    res.set({
      'Content-Type': asset.contentType,
      'Content-Length': String(asset.bytes),
      'Content-Disposition': 'attachment; filename="' + id + '"',
      'Cache-Control': 'private, no-store',
    });
    await pipeline(
      createReadStream(path.resolve(process.env.ARTIFACT_DIR ?? 'artifacts', asset.storageKey)),
      res,
    );
  }
}
