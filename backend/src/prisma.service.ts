import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma connects lazily on first query. We deliberately do NOT $connect() at
 * boot: a container that dies because Postgres is a few seconds behind it is
 * worse than one that starts and reports its database as down on /health.
 *
 * NEVER add 'query' to `log`. Query logging prints parameters, and from
 * Sprint 2 the parameters include QR tokens. Warnings and errors only
 * (src/no-query-logging.test.ts checks this).
 */
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({ log: ['warn', 'error'] });
  }
}
