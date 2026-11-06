import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma connects lazily on first query. We deliberately do NOT $connect() at
 * boot: a container that dies because Postgres is a few seconds behind it is
 * worse than one that starts and reports its database as down on /health.
 */
@Injectable()
export class PrismaService extends PrismaClient {}
