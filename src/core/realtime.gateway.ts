import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../security/auth';
import { TenantContextManager } from '../security/tenant-context.manager';
@WebSocketGateway({
  namespace: '/portal',
  cors: { origin: process.env.PORTAL_ORIGIN ?? 'http://localhost:3000' },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;
  constructor(
    private readonly auth: AuthService,
    private readonly context: TenantContextManager,
  ) {}
  async handleConnection(socket: Socket) {
    try {
      const p = await this.auth.verify(String(socket.handshake.auth.token ?? ''));
      if (!['OWNER', 'ADMIN'].includes(p.role)) return socket.disconnect(true);
      await socket.join('tenant:' + p.tenantId);
      const timer = setTimeout(() => socket.disconnect(true), 5 * 60 * 1000);
      socket.on('disconnect', () => clearTimeout(timer));
    } catch {
      socket.disconnect(true);
    }
  }
  changed(appId: string, revision: number) {
    this.server
      .to('tenant:' + this.context.current().tenantId)
      .emit('app.updated', { appId, revision });
  }
}
