import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { LIMITS, MEMORY_CAP, MemoryThrottleStore, THROTTLE_MESSAGE, throttleKeys } from './login-throttle';

/** Hardening H1 (M1): the sign-in throttle's rules and its in-memory fallback, with a fake clock. */

const SECRET = randomBytes(32).toString('hex');
const keys = (user: string, ip: string, site = 'site-1') => throttleKeys(SECRET, site, user, ip);

test('the limits: 5 per username+address pair, 20 per username, 30 per address, in 15 minutes', () => {
  assert.deepEqual(LIMITS, { pair: 5, user: 20, ip: 30, windowSeconds: 900 });
});

test('keys hold hashes, never the username or the address, and differ per site', () => {
  const k = keys('adebayo.entry', '203.0.113.7');
  for (const key of [k.pair, k.user, k.ip]) {
    assert.doesNotMatch(key, /adebayo|entry|203|113/);
    assert.match(key, /^qp:login:(pair|user|ip):[0-9a-f]{32}(:[0-9a-f]{32})?$/);
  }
  assert.ok(k.pair.startsWith(`qp:login:pair:${k.user.split(':')[3]}:`), 'pair keys start with the username hash (so a reset can clear them)');
  assert.notEqual(keys('adebayo.entry', '203.0.113.7', 'site-2').user, k.user);
  assert.equal(keys(' Adebayo.Entry ', '203.0.113.7').user, k.user, 'the username is normalised before hashing');
});

test('one message for every throttled sign-in, naming no username', () => {
  assert.match(THROTTLE_MESSAGE(61), /^Too many sign-in attempts\. Try again in 2 minutes\.$/);
  assert.match(THROTTLE_MESSAGE(30), /in 1 minute\./);
});

function clockStore() {
  let now = 1_000_000;
  const store = new MemoryThrottleStore(() => now);
  return { store, tick: (s: number) => (now += s * 1000) };
}

test('pair: 5 failures from one address block that pair; the 6th attempt is refused before any password check', async () => {
  const { store } = clockStore();
  const k = keys('a.user', '10.0.0.1');
  for (let i = 1; i <= 5; i++) {
    const r = await store.reserve(k);
    assert.equal(r.ok, true, `attempt ${i}`);
    await store.settle(k, false);
  }
  const blocked = await store.reserve(k);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.scope, 'pair');
  assert.equal(!blocked.ok && blocked.retryAfterSeconds, 900);
});

test('the 5th failure reports that it started the pair block (one audit row per block)', async () => {
  const { store } = clockStore();
  const k = keys('b.user', '10.0.0.2');
  const reached: string[][] = [];
  for (let i = 1; i <= 5; i++) {
    const r = await store.reserve(k);
    if (r.ok) reached.push(r.reachedMax);
    await store.settle(k, false);
  }
  assert.deepEqual(reached, [[], [], [], [], ['pair']]);
});

test('a single person cannot lock the account from elsewhere: another address still gets in', async () => {
  const { store } = clockStore();
  for (let i = 0; i < 5; i++) {
    await store.reserve(keys('c.user', '10.0.0.3'));
    await store.settle(keys('c.user', '10.0.0.3'), false);
  }
  assert.equal((await store.reserve(keys('c.user', '10.0.0.3'))).ok, false);
  assert.equal((await store.reserve(keys('c.user', '10.0.0.99'))).ok, true);
});

test('username: 20 failures across addresses block the username everywhere', async () => {
  const { store } = clockStore();
  for (let a = 0; a < 5; a++) {
    for (let i = 0; i < 4; i++) {
      const k = keys('d.user', `10.1.0.${a}`);
      assert.equal((await store.reserve(k)).ok, true);
      await store.settle(k, false);
    }
  }
  const r = await store.reserve(keys('d.user', '10.1.0.200'));
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.scope, 'user');
});

test('address: 30 failures for different usernames block the address', async () => {
  const { store } = clockStore();
  for (let i = 0; i < 30; i++) {
    const k = keys(`user.${i}`, '10.2.0.1');
    assert.equal((await store.reserve(k)).ok, true);
    await store.settle(k, false);
  }
  const r = await store.reserve(keys('someone.new', '10.2.0.1'));
  assert.equal(!r.ok && r.scope, 'ip');
  assert.equal((await store.reserve(keys('someone.new', '10.2.0.2'))).ok, true);
});

test('success clears the pair and gives back its reservation on the username and the address', async () => {
  const { store } = clockStore();
  const k = keys('e.user', '10.3.0.1');
  for (let i = 0; i < 4; i++) {
    await store.reserve(k);
    await store.settle(k, false);
  }
  await store.reserve(k);
  await store.settle(k, true);
  assert.deepEqual(store.counts(k), { pair: 0, user: 4, ip: 4 });
  for (let i = 0; i < 4; i++) {
    assert.equal((await store.reserve(k)).ok, true);
    await store.settle(k, false);
  }
});

test('a block ends by itself when the 15-minute window from the first failure ends; nothing is permanent', async () => {
  const { store, tick } = clockStore();
  const k = keys('f.user', '10.4.0.1');
  for (let i = 0; i < 5; i++) {
    await store.reserve(k);
    await store.settle(k, false);
  }
  tick(600);
  const r = await store.reserve(k);
  assert.equal(!r.ok && r.retryAfterSeconds, 300);
  tick(300);
  assert.equal((await store.reserve(k)).ok, true);
});

test('clearing a username (password reset, unthrottle) removes its username and pair counts, not the address count', async () => {
  const { store } = clockStore();
  for (const ip of ['10.5.0.1', '10.5.0.2']) {
    for (let i = 0; i < 5; i++) {
      await store.reserve(keys('g.user', ip));
      await store.settle(keys('g.user', ip), false);
    }
  }
  await store.clearUser(keys('g.user', '0.0.0.0').user);
  assert.equal((await store.reserve(keys('g.user', '10.5.0.1'))).ok, true);
  assert.deepEqual(store.counts(keys('g.user', '10.5.0.2')), { pair: 0, user: 1, ip: 5 });
});

test('the fallback store has a size cap and drops expired entries first, then the oldest', async () => {
  const { store, tick } = clockStore();
  assert.ok(MEMORY_CAP >= 1000 && MEMORY_CAP <= 100_000);
  for (let i = 0; i < MEMORY_CAP + 500; i++) {
    const k = keys(`cap.${i}`, `10.9.${i % 250}.${i % 7}`);
    await store.reserve(k);
    if (i === 100) tick(1000);
  }
  assert.ok(store.size() <= MEMORY_CAP, `${store.size()} entries`);
});
