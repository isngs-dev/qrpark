import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_POOL, poolUrl } from './prisma.service';

/**
 * The connection pool lets at least ten requests reach Postgres together
 * (Prisma's default is CPUs x 2 + 1, which is 5 on a two-core CI runner).
 * An explicit, larger connection_limit in DATABASE_URL is kept.
 */

test('connection_limit is added when absent, raised to 10 when smaller, kept when larger', () => {
  const limit = (url: string) => Number(new URL(url).searchParams.get('connection_limit'));
  assert.equal(MIN_POOL, 10);
  assert.equal(limit(poolUrl('postgresql://u:p@h:5432/db')), 10);
  assert.equal(limit(poolUrl('postgresql://u:p@h:5432/db?schema=public')), 10);
  assert.equal(limit(poolUrl('postgresql://u:p@h:5432/db?connection_limit=3')), 10);
  assert.equal(limit(poolUrl('postgresql://u:p@h:5432/db?connection_limit=25')), 25);
  assert.equal(new URL(poolUrl('postgresql://u:p@h:5432/db?schema=public')).searchParams.get('schema'), 'public');
});

test('no DATABASE_URL: left for Prisma to report', () => {
  assert.equal(poolUrl(undefined), undefined);
});
