import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SiteService } from './site.service';

/**
 * The two things every feature needs: the database client and the identity of
 * the site this deployment serves. Global so a single PrismaService instance
 * (and therefore a single connection pool) is shared, rather than each module
 * constructing its own.
 */
@Global()
@Module({
  providers: [PrismaService, SiteService],
  exports: [PrismaService, SiteService],
})
export class CoreModule {}
