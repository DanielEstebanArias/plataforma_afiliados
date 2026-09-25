import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../security/auth';
import { TenantContextManager } from '../security/tenant-context.manager';
import { GISController, PositionSchema } from './gis.controller';
import { Id } from '../contracts/app-config.schema';
import { z } from 'zod';
@WebSocketGateway({ namespace: '/tracking', cors: false, maxHttpBufferSize: 16384 })
export class GISGateway {
  constructor(
    private readonly auth: AuthService,
    private readonly context: TenantContextManager,
    private readonly gis: GISController,
  ) {}
  @SubscribeMessage('position')
  async position(
    @ConnectedSocket()
    socket: Socket,
    @MessageBody()
    body: unknown,
  ) {
    try {
      const p = await this.auth.verify(String(socket.handshake.auth.token ?? ''));
      if (!['OWNER', 'ADMIN', 'DEVICE'].includes(p.role)) throw new Error('Unauthorized');
      const data = z.object({ appId: Id, position: PositionSchema }).strict().parse(body);
      return await this.context.run(p, () => this.gis.position(data.appId, data.position));
    } catch {
      socket.disconnect(true);
      return { error: 'Rejected' };
    }
  }
}
