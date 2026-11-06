import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { IDEMPOTENCY_KEY_PATTERN, cleanCustomerName, replayVerdict } from './idempotency';

/** What a repeated "Take payment" may get back. Pure. */

test('idempotency key: 16-100 of A-Z a-z 0-9 _ - (a UUID fits)', () => {
  for (const ok of ['3f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10', 'a'.repeat(16), 'A_b-'.repeat(25)]) {
    assert.match(ok, IDEMPOTENCY_KEY_PATTERN);
  }
  for (const bad of ['short', 'a'.repeat(101), 'has space here 123', 'semi;colon-0123456']) {
    assert.doesNotMatch(bad, IDEMPOTENCY_KEY_PATTERN, `accepted "${bad}"`);
  }
});

test('replay: same operator, same request -> SAME (return the existing payment)', () => {
  const existing = { operatorId: 'op1', categoryCode: 'CAR', customerName: 'Ada' };
  assert.equal(replayVerdict(existing, { operatorId: 'op1', categoryCode: 'CAR', customerName: 'Ada' }), 'SAME');
});

test('replay: another operator -> OTHER_OPERATOR (409, never their payment)', () => {
  const existing = { operatorId: 'op1', categoryCode: 'CAR', customerName: null };
  assert.equal(replayVerdict(existing, { operatorId: 'op2', categoryCode: 'CAR', customerName: null }), 'OTHER_OPERATOR');
});

test('replay: same operator, different category or name -> DIFFERENT_REQUEST (409)', () => {
  const existing = { operatorId: 'op1', categoryCode: 'CAR', customerName: 'Ada' };
  assert.equal(replayVerdict(existing, { operatorId: 'op1', categoryCode: 'SUV', customerName: 'Ada' }), 'DIFFERENT_REQUEST');
  assert.equal(replayVerdict(existing, { operatorId: 'op1', categoryCode: 'CAR', customerName: null }), 'DIFFERENT_REQUEST');
});

test('customer name: optional, trimmed, blank is none, at most 100 characters', () => {
  assert.equal(cleanCustomerName(undefined), null);
  assert.equal(cleanCustomerName(null), null);
  assert.equal(cleanCustomerName('   '), null);
  assert.equal(cleanCustomerName('  Ada Obi '), 'Ada Obi');
  assert.throws(() => cleanCustomerName('x'.repeat(101)), BadRequestException);
});
