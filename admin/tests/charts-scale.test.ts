import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, heightOf, niceScale, scaleLabel, thinTicks } from '../app/(portal)/charts.scale.ts';

/**
 * UI-1: the Finance charts' scale marks. A mark is a rounded "nice" number on
 * an axis, never a figure: every amount a reader is told is the backend's.
 * This file is the one place the portal may work out a money-like number,
 * and only charts.tsx may use it (source-scan.test.ts).
 */

test('a nice scale: round steps of 1, 2, 2.5 or 5 x 10^n, the top at or above the largest value', () => {
  assert.deepEqual(niceScale(340_000, 4, 10_000), { top: 400_000, step: 100_000, marks: [0, 100_000, 200_000, 300_000, 400_000] });
  assert.deepEqual(niceScale(1_234_567, 4, 10_000), { top: 1_500_000, step: 500_000, marks: [0, 500_000, 1_000_000, 1_500_000] });
  assert.deepEqual(niceScale(17, 4, 1), { top: 20, step: 5, marks: [0, 5, 10, 15, 20] });
  assert.deepEqual(niceScale(3, 4, 1), { top: 3, step: 1, marks: [0, 1, 2, 3] });
  for (const max of [1, 9, 10, 11, 99, 101, 2_500_000, 99_999_999, 123_456_789_012]) {
    const s = niceScale(max, 4, 1);
    assert.ok(s.top >= max, `${max}: top ${s.top}`);
    assert.ok(s.marks.length >= 2 && s.marks.length <= 6, `${max}: ${s.marks.length} marks`);
    assert.ok(s.marks.every((m) => Number.isSafeInteger(m)), `${max}: whole numbers`);
  }
});

test('an empty chart still has a scale: the smallest step', () => {
  assert.deepEqual(niceScale(0, 4, 100_000), { top: 400_000, step: 100_000, marks: [0, 100_000, 200_000, 300_000, 400_000] });
  assert.deepEqual(niceScale(0, 4, 1), { top: 4, step: 1, marks: [0, 1, 2, 3, 4] });
});

test('scale labels are short naira marks from kobo, by digits', () => {
  assert.equal(scaleLabel(0), '₦0');
  assert.equal(scaleLabel(50_000), '₦500');
  assert.equal(scaleLabel(100_000), '₦1k');
  assert.equal(scaleLabel(250_000), '₦2.5k');
  assert.equal(scaleLabel(10_000_000), '₦100k');
  assert.equal(scaleLabel(150_000_000), '₦1.5m');
  assert.equal(scaleLabel(200_000_000_000), '₦2b');
  assert.equal(countLabel(0), '0');
  assert.equal(countLabel(25), '25');
  assert.equal(countLabel(1_500), '1.5k');
});

test('x-axis ticks are thinned to fit, always keeping the first and the last', () => {
  assert.deepEqual(thinTicks(5, 10), [0, 1, 2, 3, 4]);
  assert.deepEqual(thinTicks(31, 8), [0, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(thinTicks(24, 8), [0, 4, 8, 12, 16, 20, 23]);
  assert.deepEqual(thinTicks(10, 4), [0, 3, 6, 9]);
  assert.deepEqual(thinTicks(11, 4), [0, 4, 8, 10]);
  assert.deepEqual(thinTicks(1, 8), [0]);
  assert.deepEqual(thinTicks(0, 8), []);
  for (const n of [2, 7, 13, 31, 70, 366]) {
    const t = thinTicks(n, 8);
    assert.ok(t.length <= 9, `${n}: ${t.length}`);
    assert.equal(t[0], 0);
    assert.equal(t.at(-1), n - 1);
  }
});

test('a bar height is its value against the scale top, in pixels; anything above zero is at least 1px', () => {
  assert.equal(heightOf(0, 400_000, 200), 0);
  assert.equal(heightOf(400_000, 400_000, 200), 200);
  assert.equal(heightOf(100_000, 400_000, 200), 50);
  assert.equal(heightOf(1, 400_000, 200), 1);
  assert.equal(heightOf(5, 0, 200), 0);
});
