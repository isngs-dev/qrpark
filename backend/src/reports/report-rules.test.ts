import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCEL_MAX_ROWS,
  CSV_MAX_DAYS,
  JSON_MAX_DAYS,
  auditDetail,
  csvCell,
  csvDocument,
  averageKobo,
  bucketKind,
  bucketsOf,
  daysOf,
  previousRange,
  sumIntoBuckets,
  lagosStamp,
  nairaPlain,
  parseRange,
  personLabel,
  rowLimitProblem,
} from './report-rules';

/** Sprint 5a: the pure rules behind the report routes and their CSV. */

// ---------------------------------------------------------------- money

test('naira from kobo is string work: two decimals, no grouping, no floating point', () => {
  assert.equal(nairaPlain(50_000), '500.00');
  assert.equal(nairaPlain(5), '0.05');
  assert.equal(nairaPlain(0), '0.00');
  assert.equal(nairaPlain(100), '1.00');
  assert.equal(nairaPlain(123_456_789), '1234567.89');
  assert.equal(nairaPlain(9_007_199_254_740_991), '90071992547409.91');
  assert.throws(() => nairaPlain(-1));
  assert.throws(() => nairaPlain(1.5));
});

// ---------------------------------------------------------------- CSV cells

test('CSV text cells starting with = + - @ tab or CR are neutralised with a leading apostrophe', () => {
  for (const bad of ['=HYPERLINK("http://x","y")', '+cmd|calc', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
    const cell = csvCell(bad, 'text');
    assert.ok(cell.replace(/^"/, '').startsWith("'"), `${JSON.stringify(bad)} -> ${cell}`);
  }
  assert.equal(csvCell('Car', 'text'), 'Car');
  assert.equal(csvCell('Test entry 1', 'text'), 'Test entry 1');
});

test('amount and integer columns are untouched (never neutralised), and must be numbers', () => {
  assert.equal(csvCell('500.00', 'amount'), '500.00');
  assert.equal(csvCell('50000', 'int'), '50000');
  assert.throws(() => csvCell('=1+1', 'amount'));
  assert.throws(() => csvCell('-5.00', 'amount'));
  assert.throws(() => csvCell('12a', 'int'));
});

test('quotes, commas and line ends are quoted the CSV way', () => {
  assert.equal(csvCell('a,b', 'text'), '"a,b"');
  assert.equal(csvCell('say "hi"', 'text'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines', 'text'), '"two\nlines"');
  assert.equal(csvCell('=a,b', 'text'), `"'=a,b"`);
  assert.equal(csvCell(null, 'text'), '');
});

test('a CSV document is UTF-8 with a byte-order mark and CRLF line ends, for Excel', () => {
  const doc = csvDocument(['Ticket', 'Amount (NGN)'], [[csvCell('K7MP-3QZ9', 'text'), csvCell('500.00', 'amount')]]);
  assert.ok(doc.startsWith('﻿'));
  assert.equal(doc, '﻿Ticket,Amount (NGN)\r\nK7MP-3QZ9,500.00\r\n');
});

// ---------------------------------------------------------------- times

test('Lagos times as YYYY-MM-DD HH:MM (UTC+1)', () => {
  assert.equal(lagosStamp(new Date('2026-11-07T23:30:00Z')), '2026-11-08 00:30');
  assert.equal(lagosStamp(new Date('2026-11-07T13:05:59Z')), '2026-11-07 14:05');
  assert.equal(lagosStamp(null), '');
});

test('the per-hour offset cache gives exactly what Intl gives, minute by minute, across years', () => {
  const intl = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const viaIntl = (d: Date) => {
    const p = Object.fromEntries(intl.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  let seed = 20261109;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const start = Date.parse('1990-01-01T00:00:00Z');
  const span = Date.parse('2040-01-01T00:00:00Z') - start;
  for (let i = 0; i < 20_000; i++) {
    const d = new Date(start + Math.floor(rand() * span));
    assert.equal(lagosStamp(d), viaIntl(d), d.toISOString());
  }
  // Around Lagos midnight and the turn of a year, every minute.
  for (let m = -90; m <= 90; m++) {
    const d = new Date(Date.parse('2026-12-31T23:00:00Z') + m * 60_000);
    assert.equal(lagosStamp(d), viaIntl(d), d.toISOString());
  }
});

// ---------------------------------------------------------------- date ranges

test('a range defaults to today; from/to are Lagos days, from <= to', () => {
  assert.deepEqual(parseRange({}, '2026-11-09', false), { from: '2026-11-09', to: '2026-11-09' });
  assert.deepEqual(parseRange({ from: '2026-11-01', to: '2026-11-09' }, '2026-11-09', false), { from: '2026-11-01', to: '2026-11-09' });
  assert.throws(() => parseRange({ from: '2026-11-09', to: '2026-11-01' }, '2026-11-09', false), /from/);
  assert.throws(() => parseRange({ from: '2026-02-30', to: '2026-03-01' }, '2026-11-09', false));
  assert.throws(() => parseRange({ from: '09/11/2026' }, '2026-11-09', false));
  assert.throws(() => parseRange({ from: '2025-01-01', to: '2026-11-09' }, '2026-11-09', false), /366/);
  // A JSON page covers at most 366 days (as before H5): 2025-11-09..2026-11-09 is exactly 366; one day more is refused.
  assert.equal(JSON_MAX_DAYS, 366);
  assert.deepEqual(parseRange({ from: '2025-11-09', to: '2026-11-09' }, '2026-11-09', false), { from: '2025-11-09', to: '2026-11-09' });
  assert.throws(() => parseRange({ from: '2025-11-08', to: '2026-11-09' }, '2026-11-09', false), /^BadRequestException: A report covers at most 366 days\.$/);
});

test('UI-1: every Lagos day of a range, in order, across month, year and leap-day ends (byDay lists each one)', () => {
  assert.deepEqual(daysOf({ from: '2026-11-09', to: '2026-11-09' }), ['2026-11-09']);
  assert.deepEqual(daysOf({ from: '2026-10-30', to: '2026-11-02' }), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(daysOf({ from: '2026-12-31', to: '2027-01-01' }), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(daysOf({ from: '2028-02-28', to: '2028-03-01' }), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.equal(daysOf({ from: '2025-11-09', to: '2026-11-09' }).length, JSON_MAX_DAYS);
});

// ---------------------------------------------------------------- UI-1 Finance analytics

test('UI-1: the trend bucket is chosen from the range: day up to 31 days, week up to 120, month beyond', () => {
  assert.equal(bucketKind({ from: '2026-11-01', to: '2026-11-01' }), 'day');
  assert.equal(bucketKind({ from: '2026-10-01', to: '2026-10-31' }), 'day'); // 31 days
  assert.equal(bucketKind({ from: '2026-10-01', to: '2026-11-01' }), 'week'); // 32
  assert.equal(bucketKind({ from: '2026-07-15', to: '2026-11-11' }), 'week'); // 120
  assert.equal(bucketKind({ from: '2026-07-14', to: '2026-11-11' }), 'month'); // 121
});

test('UI-1: buckets cover the range exactly, in order; weeks start on Monday and months on the 1st, clipped to the range', () => {
  assert.deepEqual(bucketsOf({ from: '2026-11-10', to: '2026-11-12' }, 'day'), [
    { start: '2026-11-10', end: '2026-11-10' }, { start: '2026-11-11', end: '2026-11-11' }, { start: '2026-11-12', end: '2026-11-12' },
  ]);
  // 2026-11-04 is a Wednesday; 2026-11-09 a Monday.
  assert.deepEqual(bucketsOf({ from: '2026-11-04', to: '2026-11-18' }, 'week'), [
    { start: '2026-11-04', end: '2026-11-08' }, { start: '2026-11-09', end: '2026-11-15' }, { start: '2026-11-16', end: '2026-11-18' },
  ]);
  assert.deepEqual(bucketsOf({ from: '2027-12-30', to: '2028-03-02' }, 'month'), [
    { start: '2027-12-30', end: '2027-12-31' }, { start: '2028-01-01', end: '2028-01-31' },
    { start: '2028-02-01', end: '2028-02-29' }, { start: '2028-03-01', end: '2028-03-02' },
  ]);
  // Every day of a long range falls in exactly one bucket.
  for (const kind of ['day', 'week', 'month'] as const) {
    const r = { from: '2025-11-09', to: '2026-11-09' };
    const covered = bucketsOf(r, kind).flatMap((b) => daysOf({ from: b.start, to: b.end }));
    assert.deepEqual(covered, daysOf(r), kind);
  }
});

test('UI-1: the backend sums days into buckets in whole kobo; the buckets add up to the days', () => {
  const zero = { count: 0, kobo: 0 };
  const day = (d: string, cash: number, card: number) => ({
    day: d, cash: { count: cash ? 1 : 0, kobo: cash }, card: { count: card ? 1 : 0, kobo: card },
    total: { count: (cash ? 1 : 0) + (card ? 1 : 0), kobo: cash + card },
  });
  const days = [day('2026-11-08', 50_000, 0), day('2026-11-09', 0, 70_000), day('2026-11-10', 20_000, 20_000)];
  assert.deepEqual(sumIntoBuckets(days, [{ start: '2026-11-08', end: '2026-11-08' }, { start: '2026-11-09', end: '2026-11-15' }]), [
    { start: '2026-11-08', end: '2026-11-08', cash: { count: 1, kobo: 50_000 }, card: zero, total: { count: 1, kobo: 50_000 } },
    { start: '2026-11-09', end: '2026-11-15', cash: { count: 1, kobo: 20_000 }, card: { count: 2, kobo: 90_000 }, total: { count: 3, kobo: 110_000 } },
  ]);
});

test('UI-1: the previous period is the same number of days, ending the day before', () => {
  assert.deepEqual(previousRange({ from: '2026-11-12', to: '2026-11-12' }), { from: '2026-11-11', to: '2026-11-11' });
  assert.deepEqual(previousRange({ from: '2026-11-01', to: '2026-11-12' }), { from: '2026-10-20', to: '2026-10-31' });
  assert.deepEqual(previousRange({ from: '2028-03-01', to: '2028-03-31' }), { from: '2028-01-30', to: '2028-02-29' });
});

test('UI-1: the average payment is whole kobo, rounded half up by integer arithmetic; none without payments', () => {
  assert.equal(averageKobo({ count: 3, kobo: 100_000 }), 33_333); // 33,333.33
  assert.equal(averageKobo({ count: 2, kobo: 3 }), 2); // 1.5 rounds up
  assert.equal(averageKobo({ count: 3, kobo: 2 }), 1); // 0.67
  assert.equal(averageKobo({ count: 0, kobo: 0 }), null);
  assert.equal(averageKobo({ count: 1, kobo: 2_147_483_647 }), 2_147_483_647);
});

test(`a CSV needs both dates, and covers at most ${CSV_MAX_DAYS} days (about three months)`, () => {
  assert.equal(CSV_MAX_DAYS, 92);
  assert.throws(() => parseRange({}, '2026-11-09', true), /from and to/);
  assert.throws(() => parseRange({ from: '2026-11-01' }, '2026-11-09', true), /from and to/);
  // 2026-08-10..2026-11-09 is exactly 92 Lagos days; one day more is refused for a CSV, still fine for a JSON page.
  assert.deepEqual(parseRange({ from: '2026-08-10', to: '2026-11-09' }, '2026-11-09', true), { from: '2026-08-10', to: '2026-11-09' });
  assert.throws(() => parseRange({ from: '2026-08-09', to: '2026-11-09' }, '2026-11-09', true), /^BadRequestException: A CSV covers at most 92 days \(about three months\)\. Choose a shorter range\.$/);
  assert.deepEqual(parseRange({ from: '2026-08-09', to: '2026-11-09' }, '2026-11-09', false), { from: '2026-08-09', to: '2026-11-09' });
});

test(`a CSV holds at most ${EXCEL_MAX_ROWS} data rows (Excel's limit); more is refused with the count, never cut short`, () => {
  assert.equal(EXCEL_MAX_ROWS, 1_048_575);
  assert.equal(rowLimitProblem(EXCEL_MAX_ROWS), null);
  assert.equal(rowLimitProblem(0), null);
  assert.equal(
    rowLimitProblem(1_234_567),
    'This range has 1,234,567 rows; a CSV holds at most 1,048,575 (the most Excel can open). Choose a shorter range, for example one month at a time.',
  );
  assert.match(rowLimitProblem(EXCEL_MAX_ROWS + 1) ?? '', /1,048,576 rows/);
});

// ---------------------------------------------------------------- people

test('a deleted operator stays, as "name (deleted)"', () => {
  assert.equal(personLabel('Ada Obi', null), 'Ada Obi');
  assert.equal(personLabel('Ada Obi', new Date()), 'Ada Obi (deleted)');
  assert.equal(personLabel(null, null), '');
});

// ---------------------------------------------------------------- audit

test('the audit view shows an allow-list of detail fields only, never raw JSON', () => {
  // A cash confirmation's reference is NOT shown; only the ticket number and amount.
  assert.deepEqual(auditDetail('PAYMENT_CASH_CONFIRMED', { ticketNumber: 'K7MP-3QZ9', amountKobo: 50_000, reference: 'QRP_abc123' }), [
    { field: 'ticketNumber', value: 'K7MP-3QZ9' },
    { field: 'amountKobo', value: 50_000 },
  ]);
  assert.deepEqual(auditDetail('CATEGORY_PRICE_CHANGED', { code: 'CAR', priceKobo: { from: 50_000, to: 60_000 } }), [
    { field: 'code', value: 'CAR' },
    { field: 'priceKobo', from: 50_000, to: 60_000 },
  ]);
  assert.deepEqual(auditDetail('TICKET_REPRINTED', { ticketNumber: 'K7MP-3QZ9', issuedBy: { id: 'u-1', username: 'entry-1' } }), [
    { field: 'ticketNumber', value: 'K7MP-3QZ9' },
    { field: 'issuedBy', value: 'entry-1' },
  ]);
  assert.deepEqual(auditDetail('PAYMENT_CANCELLED', { ticketNumber: 'K7MP-3QZ9', forced: true }), [
    { field: 'ticketNumber', value: 'K7MP-3QZ9' },
    { field: 'forced', value: true },
  ]);
});

test('unknown fields, unknown actions, nested objects and long strings never pass', () => {
  assert.deepEqual(auditDetail('PAYMENT_CANCELLED', { ticketNumber: 'X', token: 'secret-token', authorizationUrl: 'https://checkout.paystack.com/a' }), [
    { field: 'ticketNumber', value: 'X' },
  ]);
  assert.deepEqual(auditDetail('SOMETHING_NEW', { ticketNumber: 'X' }), []);
  assert.deepEqual(auditDetail('USER_CREATED', { username: { nested: 'object' }, role: 'ADMIN' }), [{ field: 'role', value: 'ADMIN' }]);
  assert.deepEqual(auditDetail('USER_CREATED', null), []);
  const long = auditDetail('SETTINGS_CHANGED', { receiptOrgName: { from: 'a', to: 'x'.repeat(500) } });
  assert.ok(String(long[0].to).length <= 200);
});
