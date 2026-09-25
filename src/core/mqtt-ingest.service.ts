import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { connect, MqttClient } from 'mqtt';
import { z } from 'zod';
import { AuthService } from '../security/auth';
import { TenantContextManager } from '../security/tenant-context.manager';
import { GISController, PositionSchema } from './gis.controller';
import { Id } from '../contracts/app-config.schema';
@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private client?: MqttClient;
  private queued = 0;
  private chain = Promise.resolve();
  private log = new Logger('MqttIngest');
  constructor(
    private readonly auth: AuthService,
    private readonly context: TenantContextManager,
    private readonly gis: GISController,
  ) {}
  onModuleInit() {
    if (!process.env.MQTT_URL) return;
    const url = new URL(process.env.MQTT_URL);
    if (url.protocol !== 'mqtts:') throw new Error('MQTT requires TLS');
    this.client = connect(url.toString(), {
      username: process.env.MQTT_SERVICE_USERNAME,
      password: process.env.MQTT_SERVICE_PASSWORD,
      rejectUnauthorized: true,
      clean: true,
    });
    this.client.on('connect', () => this.client!.subscribe('superapp/+/+/positions', { qos: 1 }));
    this.client.on('error', () => this.log.error('MQTT connection failed'));
    this.client.on('message', (topic, payload) => {
      if (payload.length > 16384 || this.queued >= 1000) {
        this.log.warn('MQTT ingress capacity exceeded');
        return;
      }
      this.queued++;
      this.chain = this.chain
        .then(() => this.ingest(topic, payload))
        .catch(() => this.log.warn('MQTT position rejected'))
        .finally(() => {
          this.queued--;
        });
    });
  }
  async ingest(topic: string, payload: Buffer) {
    const data = z
      .object({ token: z.string().max(12000), appId: Id, position: PositionSchema })
      .strict()
      .parse(JSON.parse(payload.toString('utf8')));
    const principal = await this.auth.verify(data.token);
    if (
      !['OWNER', 'ADMIN', 'DEVICE'].includes(principal.role) ||
      topic !== `superapp/${principal.tenantId}/${data.appId}/positions`
    )
      throw new Error('MQTT tenant mismatch');
    await this.context.run(principal, () => this.gis.position(data.appId, data.position));
  }
  async onModuleDestroy() {
    await this.client?.endAsync();
    await this.chain;
  }
}
