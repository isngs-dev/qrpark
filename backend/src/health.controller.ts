import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { Public } from './auth/auth.guard';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Public on purpose: the container healthcheck, the uptime check and an operator's "is the
  // server up?" must work without signing in. It says nothing about any site,
  // user or ticket.
  @Public()
  @Get('health')
  async health() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const redis = (await this.redis.isReachable()) ? 'up' : 'down';

    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      database,
      redis,
      time: new Date().toISOString(),
    };
  }
}
