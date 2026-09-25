import { Injectable, HttpException, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  async consume(tenantId: string, subject: string, ai: boolean) {
    const key =
      'limit:' +
      tenantId +
      ':' +
      createHash('sha256').update(subject).digest('hex') +
      ':' +
      (ai ? 'ai' : 'api');
    const count = (await this.redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
      1,
      key,
    )) as number;
    if (count > (ai ? 10 : 300)) throw new HttpException('Rate limit exceeded', 429);
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
