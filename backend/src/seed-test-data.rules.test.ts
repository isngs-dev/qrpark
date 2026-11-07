import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_ALPHABET,
  PASSWORD_LENGTH,
  TEST_ACCOUNTS,
  TEST_CATEGORIES,
  TEST_GATES,
  generatePassword,
  testSiteProblem,
} from './seed-test-data.rules';
import { assertPriceKobo } from './config/config-rules';
import { assertPassword, normaliseUsername } from './users/user-rules';

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
  assert.deepEqual(TEST_ACCOUNTS.map((a) => `${a.username}:${a.role}:${a.gateCode}`), [
    'entry-1:ENTRY_OPERATOR:ENTRY_1',
    'booth-1:PAYMENT_OPERATOR:BOOTH_1',
    'exit-1:EXIT_OPERATOR:EXIT_1',
  ]);
  for (const a of TEST_ACCOUNTS) assert.equal(normaliseUsername(a.username), a.username);
});

test('generated passwords: 16 characters from the unambiguous alphabet, long enough, and varied', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const pw = generatePassword();
    assert.equal(pw.length, PASSWORD_LENGTH);
    for (const ch of pw) assert.ok(PASSWORD_ALPHABET.includes(ch), `unexpected "${ch}"`);
    assert.doesNotThrow(() => assertPassword(pw));
    seen.add(pw);
  }
  assert.equal(seen.size, 50);
  for (const ambiguous of '0O1lI') assert.ok(!PASSWORD_ALPHABET.includes(ambiguous));
});
