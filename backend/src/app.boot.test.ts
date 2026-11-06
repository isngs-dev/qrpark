import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

/**
 * Boots the real application, as main.ts does, and calls /health over HTTP.
 *
 * Needs DATABASE_URL and REDIS_URL pointing at running servers (docker compose
 * locally, service containers in CI). It fails rather than skips without
 * them: a skipped health test proves nothing.
 */
test('the application boots and /health reports database and Redis up', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set');
  assert.ok(process.env.REDIS_URL, 'REDIS_URL must be set');

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
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.database, 'up');
    assert.equal(body.redis, 'up');
    assert.equal(body.status, 'ok');
  } finally {
    await app.get(PrismaService).$disconnect();
    await app.close();
  }
});
