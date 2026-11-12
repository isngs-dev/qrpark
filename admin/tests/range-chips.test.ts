import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_MAX_DAYS, JSON_MAX_DAYS, activeChip, chipHref, chipRanges, csvFits, dayChips, rangeDays } from '../lib/range-chips.ts';

/**
 * UI-1 (P2): the quick range chips. Every range is worked out from the
 * backend's Lagos today by calendar arithmetic on "YYYY-MM-DD": never the
 * portal's clock. Weeks start on Monday.
 */

const byKey = (today: string) => Object.fromEntries(chipRanges(today).map((c) => [c.key, { from: c.from, to: c.to }]));

test('the six ranges from a Thursday in mid-month', () => {
  // 2026-11-12 is a Thursday.
  assert.deepEqual(byKey('2026-11-12'), {
    today: { from: '2026-11-12', to: '2026-11-12' },
    yesterday: { from: '2026-11-11', to: '2026-11-11' },
    week: { from: '2026-11-09', to: '2026-11-12' },
    last7: { from: '2026-11-06', to: '2026-11-12' },
    month: { from: '2026-11-01', to: '2026-11-12' },
    lastMonth: { from: '2026-10-01', to: '2026-10-31' },
  });
  assert.deepEqual(chipRanges('2026-11-12').map((c) => c.label), ['Today', 'Yesterday', 'This week', 'Last 7 days', 'This month', 'Last month']);
});

test('a week starts on Monday: on a Monday it is that day alone, on a Sunday the six days before too', () => {
  assert.deepEqual(byKey('2026-11-09').week, { from: '2026-11-09', to: '2026-11-09' }); // Monday
  assert.deepEqual(byKey('2026-11-15').week, { from: '2026-11-09', to: '2026-11-15' }); // Sunday
  assert.deepEqual(byKey('2026-11-01').week, { from: '2026-10-26', to: '2026-11-01' }); // Sunday, across a month end
});

test('month, year and leap-day ends', () => {
  assert.deepEqual(byKey('2027-01-01'), {
    today: { from: '2027-01-01', to: '2027-01-01' },
    yesterday: { from: '2026-12-31', to: '2026-12-31' },
    week: { from: '2026-12-28', to: '2027-01-01' },
    last7: { from: '2026-12-26', to: '2027-01-01' },
    month: { from: '2027-01-01', to: '2027-01-01' },
    lastMonth: { from: '2026-12-01', to: '2026-12-31' },
  });
  assert.deepEqual(byKey('2028-03-01').lastMonth, { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(byKey('2028-03-01').yesterday, { from: '2028-02-29', to: '2028-02-29' });
  assert.deepEqual(byKey('2027-03-01').lastMonth, { from: '2027-02-01', to: '2027-02-28' });
});

test('every chip range fits a JSON page and a CSV', () => {
  for (const today of ['2026-11-12', '2027-01-01', '2028-03-31', '2026-12-31']) {
    for (const c of chipRanges(today)) {
      assert.ok(rangeDays(c) <= CSV_MAX_DAYS && rangeDays(c) <= JSON_MAX_DAYS, `${today} ${c.key}`);
    }
  }
});

test('the chip on screen is the one whose range is shown; anything else is Custom', () => {
  assert.equal(activeChip({ from: '2026-11-12', to: '2026-11-12' }, '2026-11-12'), 'today');
  assert.equal(activeChip({ from: '2026-10-01', to: '2026-10-31' }, '2026-11-12'), 'lastMonth');
  assert.equal(activeChip({ from: '2026-11-02', to: '2026-11-05' }, '2026-11-12'), 'custom');
  // "This week" on a Monday is also "Today": the first match wins, as listed.
  assert.equal(activeChip({ from: '2026-11-09', to: '2026-11-09' }, '2026-11-09'), 'today');
});

test('a chip link keeps the page\'s filters, drops the page number and sets from and to', () => {
  assert.equal(
    chipHref('/transactions', { q: 'K7', state: 'PAID', page: '3', from: '2026-01-01', to: '2026-01-02' }, { from: '2026-11-11', to: '2026-11-11' }),
    '/transactions?q=K7&state=PAID&from=2026-11-11&to=2026-11-11',
  );
  assert.equal(chipHref('/finance', {}, { from: '2026-11-01', to: '2026-11-12' }), '/finance?from=2026-11-01&to=2026-11-12');
  assert.equal(chipHref('/audit', { action: ['USER_DELETED', 'x'], actor: '' }, { from: '2026-11-12', to: '2026-11-12' }), '/audit?action=USER_DELETED&from=2026-11-12&to=2026-11-12');
});

test('the Dashboard is one day: Today and Yesterday only', () => {
  assert.deepEqual(dayChips('2026-11-01'), [
    { key: 'today', label: 'Today', day: '2026-11-01' },
    { key: 'yesterday', label: 'Yesterday', day: '2026-10-31' },
  ]);
});

test(`a CSV covers at most ${CSV_MAX_DAYS} days: over that, the link gives way to a note`, () => {
  assert.equal(CSV_MAX_DAYS, 92);
  assert.equal(JSON_MAX_DAYS, 366);
  assert.equal(rangeDays({ from: '2026-11-12', to: '2026-11-12' }), 1);
  assert.equal(rangeDays({ from: '2028-02-28', to: '2028-03-01' }), 3);
  assert.equal(csvFits({ from: '2026-08-10', to: '2026-11-09' }), true); // exactly 92, as the backend's own test
  assert.equal(csvFits({ from: '2026-08-09', to: '2026-11-09' }), false);
});
