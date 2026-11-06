import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/**
 * Test keys only until go-live: the backend refuses to start with a live
 * Paystack key. Its own file, so the key set here cannot leak.
 */

test('a live Paystack key stops the backend from starting', async () => {
  process.env.JWT_SECRET ??= randomBytes(32).toString('hex');
  process.env.DISABLE_JOBS = '1';
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_not_a_real_key_0000000000';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');

  await assert.rejects(
    NestFactory.create(AppModule, { logger: false, abortOnError: false }),
    /LIVE key/,
  );
});
