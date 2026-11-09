import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { LIMITS } from './login-throttle';

/**
 * Hardening H1: with Redis unreachable the throttle keeps working from the
 * process's own memory (same limits), logs LOGIN_THROTTLE_DEGRADED, and
 * sign-in still works. Its own file: this process points Redis at a port
 * nothing listens on, before the app starts.
 */

let t: TestApp;
before(async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  t = await bootTestApp({ captureLogs: true });
});
after(() => t?.close());

async function login(username: string, password: string, ip: string) {
  const res = await fetch(`${t.url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, retryAfter: res.headers.get('retry-after') };
}

test('Redis down: the right password signs in, and the throttle still refuses the 6th wrong attempt', async () => {
  const health = await call(t, 'GET', '/health');
  assert.equal(health.body.redis, 'down');
  assert.equal(health.body.status, 'degraded');

  assert.equal((await login(t.users.entry.username, t.users.entry.password, '198.18.0.1')).status, 200);

  const ip = '198.18.0.2';
  const username = `down.${randomBytes(3).toString('hex')}`;
  for (let i = 0; i < LIMITS.pair; i++) assert.equal((await login(username, 'wrong-password-x', ip)).status, 401);
  const sixth = await login(username, 'wrong-password-x', ip);
  assert.equal(sixth.status, 429);
  assert.ok(Number(sixth.retryAfter) > 0);

  assert.ok(t.logs.some((l) => l.includes('LOGIN_THROTTLE_DEGRADED')), 'the fallback is logged as an error');
  assert.ok(!t.logs.some((l) => l.includes(username)), 'no log line names the typed username');
});
