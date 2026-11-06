import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** The fewest connections the pool may have: ten exit gates can validate at the same moment. */
export const MIN_POOL = 10;

/**
 * DATABASE_URL with connection_limit of at least MIN_POOL. Prisma's default
 * is CPUs x 2 + 1 (5 on a two-core host), which would queue simultaneous
 * scans in the app instead of letting Postgres decide between them. A larger
 * explicit value is kept.
 */
export function poolUrl(url: string): string;
export function poolUrl(url: undefined): undefined;
export function poolUrl(url: string | undefined): string | undefined;
export function poolUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const parsed = new URL(url);
  const current = Number(parsed.searchParams.get('connection_limit'));
  if (!Number.isFinite(current) || current < MIN_POOL) parsed.searchParams.set('connection_limit', String(MIN_POOL));
  return parsed.toString();
}

/**
 * Prisma connects lazily on first query. We deliberately do NOT $connect() at
 * boot: a container that dies because Postgres is a few seconds behind it is
 * worse than one that starts and reports its database as down on /health.
 *
 * NEVER add 'query' to `log`. Query logging prints parameters, and the
 * parameters include QR tokens. Warnings and errors only
 * (src/no-query-logging.test.ts checks this).
 */
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const url = poolUrl(process.env.DATABASE_URL);
    super({ log: ['warn', 'error'], ...(url ? { datasources: { db: { url } } } : {}) });
  }
}
