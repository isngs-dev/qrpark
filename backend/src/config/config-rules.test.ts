import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { assertCode, assertPriceKobo, cleanDisplayName, MAX_KOBO } from './config-rules';

/** Pure rules for configuration: no database, no HTTP. */

test('price: a whole number of kobo, at least 1, within INTEGER', () => {
  for (const ok of [1, 50_000, MAX_KOBO]) assert.doesNotThrow(() => assertPriceKobo(ok));
});

test('price: zero, negative, fractions, non-numbers and overflow are refused', () => {
  const bad: unknown[] = [0, -1, -50_000, 1.5, 0.1, Number.NaN, Infinity, MAX_KOBO + 1, '500', null, undefined, true, {}];
  for (const value of bad) {
    assert.throws(() => assertPriceKobo(value as number), BadRequestException, `accepted ${String(value)}`);
  }
});

test('code: upper-cased, 1-32 of A-Z 0-9 _, starting with a letter', () => {
  assert.equal(assertCode(' car ', 'category'), 'CAR');
  assert.equal(assertCode('entry_1', 'gate'), 'ENTRY_1');
  for (const bad of ['', '1CAR', 'CAR-1', 'C'.repeat(33), 'CAR 1']) {
    assert.throws(() => assertCode(bad, 'category'), BadRequestException, `accepted "${bad}"`);
  }
});

test('display name: trimmed, 1-100 characters', () => {
  assert.equal(cleanDisplayName('  Garki Market  '), 'Garki Market');
  assert.throws(() => cleanDisplayName('   '), BadRequestException);
  assert.throws(() => cleanDisplayName('x'.repeat(101)), BadRequestException);
});
