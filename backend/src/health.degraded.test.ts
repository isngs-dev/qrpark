import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * The unhappy path: Postgres unreachable. /health must still answer 200 with
 * JSON and say the database is down, never claim "ok".
 *
 * Its own file on purpose: node --test runs each file in its own process, so
 * the DATABASE_URL set here cannot leak into app.boot.test.ts. Redis stays
 * the real one, so only the database is down.
 */
test('/health reports degraded and database down when Postgres is unreachable', async () => {
  assert.ok(process.env.REDIS_URL, 'REDIS_URL must be set');
  // Port 1 on loopback: nothing listens there, so the connection is refused.
  process.env.DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/nothing';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./app.setup');
  const { PrismaService } = await import('./prisma.service');

  const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
  configureApp(app);
  try {
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.database, 'down');
    assert.equal(body.redis, 'up');
    assert.equal(body.status, 'degraded');
  } finally {
    await app.get(PrismaService).$disconnect();
    await app.close();
  }
});
