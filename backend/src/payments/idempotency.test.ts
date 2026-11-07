import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDEMPOTENCY_KEY_PATTERN, replayVerdict } from './idempotency';

/** What a repeated tap may get back. Pure. */

test('idempotency key: 16-100 of A-Z a-z 0-9 _ - (a UUID fits)', () => {
  for (const ok of ['3f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10', 'a'.repeat(16), 'A_b-'.repeat(25)]) {
    assert.match(ok, IDEMPOTENCY_KEY_PATTERN);
  }
  for (const bad of ['short', 'a'.repeat(101), 'has space here 123', 'semi;colon-0123456']) {
    assert.doesNotMatch(bad, IDEMPOTENCY_KEY_PATTERN, `accepted "${bad}"`);
  }
});

test('replay: same operator, same request -> SAME (return the existing row)', () => {
  assert.equal(replayVerdict({ operatorId: 'op1', subject: 'CAR' }, { operatorId: 'op1', subject: 'CAR' }), 'SAME');
});

test('replay: another operator -> OTHER_OPERATOR (409, never their row)', () => {
  assert.equal(replayVerdict({ operatorId: 'op1', subject: 'CAR' }, { operatorId: 'op2', subject: 'CAR' }), 'OTHER_OPERATOR');
});

test('replay: same operator, different request -> DIFFERENT_REQUEST (409)', () => {
  assert.equal(replayVerdict({ operatorId: 'op1', subject: 'CAR' }, { operatorId: 'op1', subject: 'SUV' }), 'DIFFERENT_REQUEST');
  assert.equal(
    replayVerdict({ operatorId: 'op1', subject: 'ticket-1:CASH' }, { operatorId: 'op1', subject: 'ticket-1:CARD' }),
    'DIFFERENT_REQUEST',
  );
});
