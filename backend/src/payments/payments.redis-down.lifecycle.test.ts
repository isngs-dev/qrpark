import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { addCategory, startPayment } from '../test-support/payments';

/**
 * Fail closed: with Redis unreachable no payment can start, because the lock
 * that protects the card cannot be taken. Its own file, so the dead
 * REDIS_URL set here cannot leak into other tests (node --test runs each file
 * in its own process).
 */

let t: TestApp;
before(async () => {
  // Port 1 on loopback: nothing listens, the connection is refused.
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  t = await bootTestApp();
  await addCategory(t, 'CAR', 50_000);
});
after(() => t?.close());

test('Redis down: POST /payments is 503, nothing is written and Paystack is not called', async () => {
  const before = await t.prisma.payment.count({ where: { siteId: t.siteId } });
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.equal(await t.prisma.payment.count({ where: { siteId: t.siteId } }), before);
  assert.equal(t.paystack.initCalls.length, 0);
});

test('Redis down: /health says so', async () => {
  const res = await call(t, 'GET', '/health');
  assert.equal(res.body.redis, 'down');
  assert.equal(res.body.status, 'degraded');
});
