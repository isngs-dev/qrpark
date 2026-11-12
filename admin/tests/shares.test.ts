import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barWidths, changeLabel, shareLabels, shares } from '../lib/shares.ts';

/**
 * UI-1 (P1, P3): shares of a total and bar lengths, display only. They come
 * from the backend's integer kobo with integer arithmetic, and are never an
 * amount: nothing here is ever shown in naira.
 */

const sum = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

test('shares are tenths of a percent and always add up to exactly 100.0%', () => {
  assert.deepEqual(shares([1, 1, 1]), [334, 333, 333]); // never 99.9% or 100.1%
  assert.deepEqual(shares([2, 1]), [667, 333]);
  assert.deepEqual(shares([50_000, 150_000]), [250, 750]);
  for (const parts of [[1, 2], [3, 3, 3], [1, 1, 1, 1, 1, 1, 1], [999_999, 1], [7, 0, 13], [123_456_789, 987_654_321, 5]]) {
    assert.equal(sum(shares(parts)), 1000, String(parts));
  }
});

test('a share is shown with one decimal, and never as 0% or 100% when it is not', () => {
  assert.deepEqual(shareLabels([1, 1]), ['50.0%', '50.0%']);
  assert.deepEqual(shareLabels([1, 1, 1]), ['33.4%', '33.3%', '33.3%']);
  // 1 kobo of card in ₦1m: "0.0%" would say "no card at all".
  assert.deepEqual(shareLabels([99_999_999, 1]), ['>99.9%', '<0.1%']);
  assert.deepEqual(shareLabels([5, 0]), ['100%', '0%']);
});

test('nothing to share: no percentages at all', () => {
  assert.deepEqual(shares([0, 0]), [null, null]);
  assert.deepEqual(shareLabels([0, 0]), ['–', '–']);
});

test('the largest-remainder rounding with very large totals stays exact (integer arithmetic)', () => {
  const big = [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 2, 3];
  assert.equal(sum(shares(big)), 1000);
});

test('bar lengths are a percentage of the largest value, never a sum', () => {
  assert.deepEqual(barWidths([100, 50, 0]), [100, 50, 0]);
  assert.deepEqual(barWidths([3, 1]), [100, 33.3]);
  assert.deepEqual(barWidths([0, 0]), [0, 0]);
  // A small value still shows: never a bar of 0 for something above 0.
  assert.ok(barWidths([1_000_000, 1])[1] > 0);
});

test('only whole kobo: anything else is refused', () => {
  assert.throws(() => shares([1.5, 2]));
  assert.throws(() => shares([-1, 2]));
  assert.throws(() => barWidths([Number.NaN]));
});

test('UI-1: change against the previous period, one decimal, rounded half away from zero, never a false 0%', () => {
  assert.equal(changeLabel(110, 100), '+10.0%');
  assert.equal(changeLabel(90, 100), '−10.0%');
  assert.equal(changeLabel(100, 100), '0.0%');
  assert.equal(changeLabel(1001, 1000), '+0.1%');
  assert.equal(changeLabel(10_005, 10_000), '+0.1%'); // +0.05% rounds away from zero
  assert.equal(changeLabel(100_001, 100_000), '+<0.1%'); // more, but under 0.1%
  assert.equal(changeLabel(0, 100), '−100.0%');
  assert.equal(changeLabel(5, 0), 'new');
  assert.equal(changeLabel(0, 0), '–');
  assert.equal(changeLabel(Number.MAX_SAFE_INTEGER, 1), '+900719925474099000.0%');
  assert.throws(() => changeLabel(1.5, 2));
});
