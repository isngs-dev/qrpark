import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SiteService } from './site.service';

/**
 * The two things every feature needs: the database client and the identity of
 * the site this deployment serves. Global so a single PrismaService instance
 * (and therefore a single connection pool) is shared, rather than each module
 * constructing its own. The Redis connection and the audit log moved here in
 * Hardening H1, so the sign-in throttle (auth module) shares the one instance.
 */
@Global()
@Module({
  providers: [PrismaService, SiteService, RedisService, AuditService],
  exports: [PrismaService, SiteService, RedisService, AuditService],
})
export class CoreModule {}
