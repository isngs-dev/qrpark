import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { unthrottle } from '../unthrottle';
import { LIMITS } from './login-throttle';

/**
 * Hardening H1 (M1): the sign-in throttle through the real routes, the real
 * Redis and the database. Each test uses its own usernames and addresses
 * (X-Forwarded-For; the app trusts exactly one proxy hop), so tests do not
 * share counts; every key also carries this test site.
 */

let t: TestApp;
let redis: Redis;
before(async () => {
  t = await bootTestApp();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
});
after(async () => {
  redis?.disconnect();
  await t?.close();
});

const addr = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
const tag = () => randomBytes(3).toString('hex');

async function login(username: string, password: string, ip: string) {
  const res = await fetch(`${t.url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text();
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: text ? JSON.parse(text) : null };
}

/** A real operator of this site, with a known password, for one test. */
async function operator() {
  const username = `thr.${tag()}`;
  const password = `pw-${randomBytes(9).toString('hex')}`;
  const res = await call(t, 'POST', '/admin/users', {
    token: await t.accessToken(t.users.admin.id),
    body: { username, name: `Throttle ${username}`, role: 'ENTRY_OPERATOR', gateId: t.entryGateId, password },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id as string, username, password };
}

const throttled = async () =>
  t.prisma.auditLog.findMany({ where: { siteId: t.siteId, action: 'LOGIN_THROTTLED' as never }, orderBy: { occurredAt: 'asc' } });

// ---------------------------------------------------------------- the rule

test('5 wrong passwords from one address: the 6th attempt is 429 with Retry-After, and the right password is refused too', async () => {
  const u = await operator();
  const ip = addr();
  for (let i = 1; i <= LIMITS.pair; i++) assert.equal((await login(u.username, 'wrong-password-x', ip)).status, 401, `attempt ${i}`);
  const sixth = await login(u.username, 'wrong-password-x', ip);
  assert.equal(sixth.status, 429);
  const wait = Number(sixth.retryAfter);
  assert.ok(Number.isInteger(wait) && wait > 0 && wait <= LIMITS.windowSeconds, `Retry-After ${sixth.retryAfter}`);
  assert.match(sixth.body.message, /^Too many sign-in attempts\. Try again in \d+ minutes?\.$/);
  const right = await login(u.username, u.password, ip);
  assert.equal(right.status, 429, 'a correct password is refused while blocked (or the throttle would confirm a guess)');
});

test('the same 429 answer for a real username and an unknown one', async () => {
  const u = await operator();
  const ipA = addr();
  const ipB = '192.0.2.200';
  const unknown = `nobody.${tag()}`;
  for (let i = 0; i < LIMITS.pair; i++) {
    await login(u.username, 'wrong-password-x', ipA);
    await login(unknown, 'wrong-password-x', ipB);
  }
  const real = await login(u.username, 'wrong-password-x', ipA);
  const none = await login(unknown, 'wrong-password-x', ipB);
  assert.equal(real.status, 429);
  assert.equal(none.status, 429);
  assert.deepEqual(real.body, none.body);
});

test('a single person cannot lock an account from elsewhere: the owner signs in from another address', async () => {
  const u = await operator();
  const attacker = addr();
  for (let i = 0; i < LIMITS.pair + 3; i++) await login(u.username, 'wrong-password-x', attacker);
  assert.equal((await login(u.username, u.password, '192.0.2.10')).status, 200);
});

test('20 failures across addresses block the username everywhere, even with the right password', async () => {
  const u = await operator();
  for (let a = 0; a < 5; a++) for (let i = 0; i < 4; i++) assert.equal((await login(u.username, 'wrong-password-x', `203.0.113.${a + 10}`)).status, 401);
  const res = await login(u.username, u.password, '203.0.113.99');
  assert.equal(res.status, 429);
  assert.ok(Number(res.retryAfter) > 0);
});

test('30 failures from one address (any usernames) block that address', async () => {
  const ip = addr();
  for (let i = 0; i < LIMITS.ip; i++) assert.equal((await login(`spray.${tag()}`, 'wrong-password-x', ip)).status, 401);
  const u = await operator();
  assert.equal((await login(u.username, u.password, ip)).status, 429);
  assert.equal((await login(u.username, u.password, '192.0.2.77')).status, 200);
});

test('a successful sign-in clears the pair\'s count', async () => {
  const u = await operator();
  const ip = addr();
  for (let i = 0; i < LIMITS.pair - 1; i++) await login(u.username, 'wrong-password-x', ip);
  assert.equal((await login(u.username, u.password, ip)).status, 200);
  for (let i = 0; i < LIMITS.pair - 1; i++) assert.equal((await login(u.username, 'wrong-password-x', ip)).status, 401, 'counting again from zero');
  assert.equal((await login(u.username, u.password, ip)).status, 200);
});

// ---------------------------------------------------------------- audit, keys, exits

test('one LOGIN_THROTTLED audit row per block, no signed-in actor, no typed value and no address', async () => {
  const u = await operator();
  const ip = addr();
  const before = (await throttled()).length;
  for (let i = 0; i < LIMITS.pair + 4; i++) await login(u.username, 'wrong-password-x', ip);
  const rows = (await throttled()).slice(before);
  assert.equal(rows.length, 1, 'one row for the one block, not one per refused attempt');
  const row = rows[0];
  assert.equal(row.actorId, null);
  assert.equal(row.targetType, 'user');
  assert.equal(row.targetId, u.id);
  assert.deepEqual(Object.keys(row.detail as object).sort(), ['blockedSeconds', 'failures', 'scope', 'windowMinutes']);
  assert.equal((row.detail as { scope: string }).scope, 'pair');
  const json = JSON.stringify(row);
  for (const secret of [u.username, 'wrong-password-x', ip]) assert.ok(!json.includes(secret), `the audit row holds ${secret}`);

  // An unknown username's block points at no account.
  const nobody = `ghost.${tag()}`;
  const before2 = (await throttled()).length;
  for (let i = 0; i < LIMITS.pair; i++) await login(nobody, 'wrong-password-x', ip.replace(/\d+$/, '251'));
  const ghost = (await throttled()).slice(before2);
  assert.equal(ghost.length, 1);
  assert.equal(ghost[0].targetType, 'login');
  assert.ok(!JSON.stringify(ghost[0]).includes(nobody));
});

test('the audit view shows a throttle row with "—" for who, and only the allowed fields', async () => {
  const res = await call(t, 'GET', '/admin/audit?action=LOGIN_THROTTLED&pageSize=200', { token: await t.accessToken(t.users.admin.id) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.rows.length >= 1);
  for (const r of res.body.rows) {
    assert.equal(r.actor, null);
    assert.deepEqual(r.detail.map((d: { field: string }) => d.field).sort(), ['blockedSeconds', 'failures', 'scope', 'windowMinutes']);
  }
});

test('every throttle key in Redis has a TTL and holds a hash, never a username or an address', async () => {
  const u = await operator();
  const ip = addr();
  for (let i = 0; i < 3; i++) await login(u.username, 'wrong-password-x', ip);
  const keys = await redis.keys('qp:login:*');
  assert.ok(keys.length >= 3);
  for (const k of keys) {
    assert.match(k, /^qp:login:(pair|user|ip):[0-9a-f]{32}(:[0-9a-f]{32})?$/);
    assert.ok(!k.includes(u.username) && !k.includes(ip));
    const ttl = await redis.pttl(k);
    assert.ok(ttl > 0 && ttl <= LIMITS.windowSeconds * 1000, `${k} ttl ${ttl}`);
  }
});

test('an admin resetting the password clears the block: the new password works at once', async () => {
  const u = await operator();
  const ip = addr();
  for (let i = 0; i < LIMITS.pair; i++) await login(u.username, 'wrong-password-x', ip);
  assert.equal((await login(u.username, u.password, ip)).status, 429);
  const newPassword = `new-${randomBytes(9).toString('hex')}`;
  const reset = await call(t, 'POST', `/admin/users/${u.id}/password`, { token: await t.accessToken(t.users.admin.id), body: { password: newPassword } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal((await login(u.username, newPassword, ip)).status, 200);
});

test('the unthrottle command clears a username\'s block', async () => {
  const u = await operator();
  const ip = addr();
  for (let i = 0; i < LIMITS.pair; i++) await login(u.username, 'wrong-password-x', ip);
  assert.equal((await login(u.username, u.password, ip)).status, 429);
  const cleared = await unthrottle(u.username.toUpperCase(), { ...process.env, SITE_CODE: t.siteCode });
  assert.ok(cleared >= 2, `${cleared} keys cleared`);
  assert.equal((await login(u.username, u.password, ip)).status, 200);
});

// ---------------------------------------------------------------- timing and concurrency

test('an unknown username still pays for a password hash: no timing difference to tell it from a wrong password', async () => {
  const u = await operator();
  const time = async (username: string, i: number) => {
    const t0 = performance.now();
    const r = await login(username, 'wrong-password-x', `192.0.2.${100 + i}`);
    assert.equal(r.status, 401);
    return performance.now() - t0;
  };
  const real: number[] = [];
  const unknown: number[] = [];
  for (let i = 0; i < 6; i++) {
    real.push(await time(u.username, i));
    unknown.push(await time(`nobody.${tag()}`, i + 50));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const ratio = median(unknown) / median(real);
  assert.ok(median(real) > 5, `a real failure costs a hash (${median(real).toFixed(1)} ms)`);
  assert.ok(ratio > 0.6 && ratio < 1.6, `unknown/real median ${ratio.toFixed(2)} (${median(unknown).toFixed(1)} / ${median(real).toFixed(1)} ms)`);
});

test('50 wrong passwords at once from one address: exactly 5 are checked (401), 45 refused (429)', async () => {
  const u = await operator();
  const ip = addr();
  const results = await Promise.all(Array.from({ length: 50 }, () => login(u.username, 'wrong-password-x', ip)));
  const count = (s: number) => results.filter((r) => r.status === s).length;
  assert.equal(count(401), LIMITS.pair);
  assert.equal(count(429), 50 - LIMITS.pair);
});

test('50 wrong passwords at once from 50 addresses: exactly 20 are checked (401), 30 refused (429)', async () => {
  const u = await operator();
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => login(u.username, 'wrong-password-x', `100.64.${7}.${i + 1}`)));
  const count = (s: number) => results.filter((r) => r.status === s).length;
  assert.equal(count(401), LIMITS.user);
  assert.equal(count(429), 50 - LIMITS.user);
  assert.equal((await throttled()).filter((r) => r.targetId === u.id).length, 1, 'one audit row for the username block');
});
