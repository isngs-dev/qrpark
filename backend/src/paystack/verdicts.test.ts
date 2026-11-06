import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountMatches,
  assertNotLiveKey,
  paystackMode,
  paystackPaidAt,
  windowExpired,
} from './verdicts';

/** Pure Paystack decisions: no database, no network. */

test('payment window: expired only when strictly older than the window', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const at = (iso: string) => new Date(iso);
  assert.equal(windowExpired(at('2026-11-06T09:54:59Z'), now, 5), true);
  assert.equal(windowExpired(at('2026-11-06T09:55:00Z'), now, 5), false, 'exactly at the window is still open');
  assert.equal(windowExpired(at('2026-11-06T09:59:00Z'), now, 5), false);
  assert.equal(windowExpired(at('2026-11-06T10:05:00Z'), now, 5), false, 'a future date (clock skew) is never old');
});

test('amount check: Paystack must report exactly our integer kobo amount, in NGN', () => {
  const ours = { amountKobo: 50_000 };
  assert.equal(amountMatches(ours, { amount: 50_000, currency: 'NGN' }), true);
  assert.equal(amountMatches(ours, { amount: 49_999, currency: 'NGN' }), false);
  assert.equal(amountMatches(ours, { amount: 50_001, currency: 'NGN' }), false);
  assert.equal(amountMatches(ours, { amount: 500, currency: 'NGN' }), false, 'naira instead of kobo');
  assert.equal(amountMatches(ours, { amount: 50_000, currency: 'USD' }), false);
  assert.equal(amountMatches(ours, { amount: '50000', currency: 'NGN' }), false, 'a string is not an amount');
  assert.equal(amountMatches(ours, { amount: 50_000.5, currency: 'NGN' }), false);
  assert.equal(amountMatches(ours, { currency: 'NGN' }), false);
  assert.equal(amountMatches(ours, { amount: 50_000 }), false, 'a missing currency is not NGN');
});

test('mode: test key, live key refused, no key "not configured"', () => {
  assert.equal(paystackMode('sk_test_abc'), 'test');
  assert.equal(paystackMode(undefined), 'not configured');
  assert.equal(paystackMode(''), 'not configured');
  assert.doesNotThrow(() => assertNotLiveKey('sk_test_abc'));
  assert.doesNotThrow(() => assertNotLiveKey(undefined));
  assert.throws(() => assertNotLiveKey('sk_live_abc'), /live/i);
  assert.throws(() => assertNotLiveKey('  sk_live_abc'), /live/i);
});

test("Paystack's own paid time is read from the payload, or null", () => {
  assert.equal(paystackPaidAt({ paid_at: '2026-11-06T09:58:01.000Z' })?.toISOString(), '2026-11-06T09:58:01.000Z');
  assert.equal(paystackPaidAt({ paidAt: '2026-11-06T09:58:01.000Z' })?.toISOString(), '2026-11-06T09:58:01.000Z');
  assert.equal(paystackPaidAt({}), null);
  assert.equal(paystackPaidAt({ paid_at: 'not a date' }), null);
  assert.equal(paystackPaidAt({ paid_at: 12345 }), null);
});
