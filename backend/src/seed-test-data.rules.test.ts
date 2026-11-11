import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_ACCOUNTS, TEST_CATEGORIES, TEST_GATES, testSiteProblem } from './seed-test-data.rules';
import { WEAK_PASSWORDS, seedPasswordProblem } from './seed-passwords';
import { assertPriceKobo } from './config/config-rules';
import { normaliseUsername } from './users/user-rules';

/** Adapted from eparking backend/src/seed-test-data.rules.test.ts. */

test('only a site code ending exactly in "-test" may be seeded', () => {
  assert.equal(testSiteProblem('garki-test'), null);
  for (const bad of [undefined, 'garki', '-test', 'garki-TEST', 'garki-testing', 'garki-test ', '']) {
    assert.match(testSiteProblem(bad) ?? '', /^Refused/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the six categories, each a valid flat price in integer kobo', () => {
  assert.deepEqual(TEST_CATEGORIES.map((c) => c.code), ['CAR', 'SUV', 'BIKE', 'VAN', 'TRUCK', 'LORRY']);
  for (const c of TEST_CATEGORIES) assert.doesNotThrow(() => assertPriceKobo(c.priceKobo), c.code);
});

test('gates ENTRY_1, EXIT_1, BOOTH_1, BOOTH_2; one operator per job, each at a location of its kind', () => {
  assert.deepEqual(TEST_GATES.map((g) => `${g.code}:${g.direction}`), ['ENTRY_1:ENTRY', 'EXIT_1:EXIT', 'BOOTH_1:BOOTH', 'BOOTH_2:BOOTH']);
  assert.deepEqual(TEST_ACCOUNTS.map((a) => `${a.username}:${a.role}:${a.gateCode}:${a.passwordVar}`), [
    'entry-1:ENTRY_OPERATOR:ENTRY_1:SEED_ENTRY_PASSWORD',
    'booth-1:PAYMENT_OPERATOR:BOOTH_1:SEED_BOOTH_PASSWORD',
    'exit-1:EXIT_OPERATOR:EXIT_1:SEED_EXIT_PASSWORD',
  ]);
  for (const a of TEST_ACCOUNTS) assert.equal(normaliseUsername(a.username), a.username);
});

// Sprint 6a: seed passwords come from the server's .env (SEED_*), never generated or printed.
test('a seed password: missing, under 12 characters or obviously weak is refused; the message never holds it', () => {
  const strong = 'Tz7-mangrove-lantern';
  assert.equal(seedPasswordProblem('SEED_ENTRY_PASSWORD', strong, 'entry-1'), null);
  assert.match(seedPasswordProblem('SEED_ENTRY_PASSWORD', undefined, 'entry-1') ?? '', /^SEED_ENTRY_PASSWORD is not set/);
  assert.match(seedPasswordProblem('SEED_ENTRY_PASSWORD', '', 'entry-1') ?? '', /^SEED_ENTRY_PASSWORD is not set/);
  assert.match(seedPasswordProblem('SEED_ENTRY_PASSWORD', 'Tz7-mangrov', 'entry-1') ?? '', /^SEED_ENTRY_PASSWORD is too short: at least 12 characters/);
  const weak = [
    'password1234', 'PASSWORD1234', 'Password1234!', '123456789012', 'qwertyuiop12', 'aaaaaaaaaaaa', '111111111111',
    'myqrparkpass1', 'garki-market-2026', 'entry-1-secret', 'abcdefghijkl', 'changeme1234', 'administrator',
  ];
  for (const w of weak) {
    const problem = seedPasswordProblem('SEED_ENTRY_PASSWORD', w, 'entry-1');
    assert.match(problem ?? '', /^SEED_ENTRY_PASSWORD is too weak/, `accepted ${w}`);
    assert.ok(!problem!.includes(w), 'the message quotes the password');
  }
  assert.ok(WEAK_PASSWORDS.length >= 10);
  for (const w of WEAK_PASSWORDS) assert.match(seedPasswordProblem('SEED_X', w, 'someone') ?? '', /too weak|too short/, w);
});

// 6a follow-up: Docker Compose reads $ as a variable and # as a comment in .env (and quotes,
// backslash and spaces change a value), so such a password would be saved mangled.
test('a seed password with $ # quotes ` \\ or whitespace is refused, naming the variable, never the password', () => {
  const base = 'Tz7-mangrove-lantern';
  for (const ch of ['$', '#', "'", '"', '`', '\\', ' ', '\t', '\n']) {
    const value = `${base.slice(0, 8)}${ch}${base.slice(8)}`;
    const problem = seedPasswordProblem('SEED_BOOTH_PASSWORD', value, 'booth-1');
    assert.match(problem ?? '', /^SEED_BOOTH_PASSWORD contains a character the server's \.env cannot hold safely/, JSON.stringify(ch));
    assert.ok(!problem!.includes(value) && !problem!.includes(base), 'the message quotes the password');
  }
  // What stays allowed: letters, digits and the other punctuation.
  assert.equal(seedPasswordProblem('SEED_BOOTH_PASSWORD', 'Tz7-mangrove_lantern.!@%^&*()+=:;,?/<>[]{}|~', 'booth-1'), null);
});
