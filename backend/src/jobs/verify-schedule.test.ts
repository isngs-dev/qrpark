import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKOUT_VERIFY_DELAYS_MS, verifyDelays } from './verify-schedule';

/**
 * When the delayed Paystack checks run after a payment starts. Pure.
 *
 * Without a webhook, the 20 s check alone left a customer who finished paying
 * at 25 s waiting up to 2 minutes for the sweep. So there are more checks,
 * but only inside the payment window: a check after it would be the sweep's
 * job, and a check never changes a payment on a timer alone (only on
 * Paystack's answer, see settlement.service.ts).
 */

test('the checkout schedule: 20, 45, 90, 150 and 240 seconds', () => {
  assert.deepEqual(CHECKOUT_VERIFY_DELAYS_MS, [20_000, 45_000, 90_000, 150_000, 240_000]);
});

test('accepted checkout, 5-minute window: all five checks', () => {
  assert.deepEqual(verifyDelays('accepted', 5), [20_000, 45_000, 90_000, 150_000, 240_000]);
});

test('only checks strictly inside the window are scheduled', () => {
  assert.deepEqual(verifyDelays('accepted', 1), [20_000, 45_000]);
  assert.deepEqual(verifyDelays('accepted', 2), [20_000, 45_000, 90_000]);
  assert.deepEqual(verifyDelays('accepted', 3), [20_000, 45_000, 90_000, 150_000]);
  assert.deepEqual(verifyDelays('accepted', 4), [20_000, 45_000, 90_000, 150_000], 'exactly at the window is not inside it');
  for (const minutes of [1, 2, 3, 4, 5, 10, 30]) {
    for (const delay of verifyDelays('accepted', minutes)) {
      assert.ok(delay < minutes * 60_000, `${delay} ms is not inside a ${minutes}-minute window`);
    }
  }
});

test('Paystack did not answer the start: a check within seconds, then the same schedule', () => {
  assert.deepEqual(verifyDelays('unknown', 5), [3_000, 20_000, 45_000, 90_000, 150_000, 240_000]);
  assert.deepEqual(verifyDelays('unknown', 1), [3_000, 20_000, 45_000]);
});

test('every schedule is strictly increasing, with no duplicate delay (each is its own job)', () => {
  for (const outcome of ['accepted', 'unknown'] as const) {
    for (const minutes of [1, 5, 30]) {
      const delays = verifyDelays(outcome, minutes);
      for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1]);
    }
  }
});
