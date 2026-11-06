import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * The shared Redis connection. Sprint 0 only needs to know it is reachable;
 * the payment lock (Sprint 2) and the BullMQ jobs build on it.
 *
 * Created on first use, not at boot, for the same reason PrismaService
 * connects lazily: a container that starts and reports Redis as down on
 * /health is better than one that dies because Redis is a few seconds late.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  private redis(): Redis {
    if (this.client === null) {
      this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
        // Fail fast rather than queueing behind a dead server.
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
      // Without a listener ioredis prints every reconnect failure as an
      // unhandled error event.
      this.client.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
    }
    return this.client;
  }

  async isReachable(): Promise<boolean> {
    try {
      return (await this.redis().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client !== null) {
      this.client.disconnect();
      this.client = null;
    }
  }
}
