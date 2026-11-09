import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvResponse } from '../lib/csv-route.ts';
import {
  INCOMPLETE_LABELS,
  REPORTS,
  STATE_LABELS,
  csvBackendPath,
  csvHref,
  dayLabel,
  pageLinks,
  rangeLabel,
  reportQuery,
} from '../lib/reports-types.ts';

/** Sprint 5c: the report pages' own rules. Every figure, day and decision is the backend's. */

// ---------------------------------------------------------------- queries

test('a report query carries only that report\'s parameters, trimmed, empty ones dropped', () => {
  assert.equal(
    reportQuery('transactions', { q: ' 9k7 ', state: 'PAID', booth: '', evil: 'x', format: 'csv', category: ['CAR', 'BIKE'] }, { page: 2 }),
    'q=9k7&state=PAID&category=CAR&page=2&pageSize=50',
  );
  assert.equal(reportQuery('audit', { action: 'USER_DELETED', actor: 'u1', q: 'nope' }, { page: 1 }), 'action=USER_DELETED&actor=u1&page=1&pageSize=50');
  assert.equal(reportQuery('finance', { from: '2026-11-01', to: '2026-11-09', state: 'PAID' }), 'from=2026-11-01&to=2026-11-09');
});

test('no date of the portal\'s own: with no day chosen nothing is sent, so the backend uses its Lagos today', () => {
  assert.equal(reportQuery('finance', {}), '');
  assert.equal(reportQuery('incomplete', { from: '', to: '  ' }), '');
  assert.equal(reportQuery('dashboard', {}), '');
  assert.equal(reportQuery('dashboard', { day: '2026-11-08', from: '2026-11-01' }), 'day=2026-11-08');
});

test('a CSV link uses the range the backend answered with, and the filters on screen', () => {
  assert.equal(
    csvHref('transactions', { from: '2026-11-09', to: '2026-11-09' }, { q: 'K7', state: 'PAID', page: '3' }),
    '/csv/transactions?from=2026-11-09&to=2026-11-09&q=K7&state=PAID',
  );
  assert.equal(csvHref('finance', { from: '2026-11-01', to: '2026-11-09' }, {}), '/csv/finance?from=2026-11-01&to=2026-11-09');
});

// ---------------------------------------------------------------- the CSV route's request

test('the CSV route serves only the four reports, with an allow-list of parameters', () => {
  assert.deepEqual(Object.keys(REPORTS).filter((r) => REPORTS[r as keyof typeof REPORTS].csv).sort(), ['audit', 'finance', 'incomplete', 'transactions']);
  const ok = csvBackendPath('finance', new URLSearchParams('from=2026-11-01&to=2026-11-09'));
  assert.deepEqual(ok, { path: '/admin/reports/finance?from=2026-11-01&to=2026-11-09&format=csv' });
  assert.deepEqual(csvBackendPath('audit', new URLSearchParams('from=2026-11-01&to=2026-11-02&action=USER_DELETED')), {
    path: '/admin/audit?from=2026-11-01&to=2026-11-02&action=USER_DELETED&format=csv',
  });
  for (const bad of ['dashboard', 'users', '../auth/login', 'transactions/abc', '']) {
    assert.ok('error' in csvBackendPath(bad, new URLSearchParams('from=2026-11-01&to=2026-11-02')), bad);
  }
  for (const q of ['from=2026-11-01&to=2026-11-02&format=json', 'from=2026-11-01&to=2026-11-02&pageSize=999', 'from=2026-11-01&to=2026-11-02&q=AB2', 'from=a&from=b&to=c']) {
    assert.ok('error' in csvBackendPath('finance', new URLSearchParams(q)), q);
  }
  assert.ok('path' in csvBackendPath('transactions', new URLSearchParams('from=2026-11-01&to=2026-11-02&q=AB2&state=PAID')));
});

// ---------------------------------------------------------------- the CSV route's response

const fakeFetch = (respond: () => Response) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fn, calls };
};

const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Ticket,Amount (NGN)\r\n'=HYPERLINK(1),500.00\r\n")]);

test('no admin cookie: refused, and the backend is never called', async () => {
  const f = fakeFetch(() => new Response('x'));
  const res = await csvResponse('finance', new URLSearchParams('from=2026-11-01&to=2026-11-02'), undefined, f.fn, 'http://backend');
  assert.equal(res.status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a refused request (report or parameter) never reaches the backend', async () => {
  const f = fakeFetch(() => new Response('x'));
  const res = await csvResponse('dashboard', new URLSearchParams(''), 'tok', f.fn, 'http://backend');
  assert.equal(res.status, 400);
  const res2 = await csvResponse('finance', new URLSearchParams('from=1&to=2&evil=1'), 'tok', f.fn, 'http://backend');
  assert.equal(res2.status, 400);
  assert.equal(f.calls.length, 0);
});

test('the backend\'s file passes through byte for byte, with its filename, no-store and nosniff', async () => {
  const f = fakeFetch(() => new Response(BYTES, { status: 200, headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="qrpark-finance-2026-11-01-to-2026-11-02.csv"',
    'set-cookie': 'x=1',
  } }));
  const res = await csvResponse('finance', new URLSearchParams('from=2026-11-01&to=2026-11-02'), 'tok', f.fn, 'http://backend');
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="qrpark-finance-2026-11-01-to-2026-11-02.csv"');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('set-cookie'), null, 'nothing else of the backend\'s passes');
  assert.equal(f.calls[0].url, 'http://backend/admin/reports/finance?from=2026-11-01&to=2026-11-02&format=csv');
  assert.equal(new Headers(f.calls[0].init?.headers).get('authorization'), 'Bearer tok');
  assert.equal(f.calls[0].init?.method ?? 'GET', 'GET');
});

test('the backend\'s refusal is shown as written, with its status', async () => {
  const msg = 'More than 50000 rows: narrow the date range or the filters.';
  const f = fakeFetch(() => new Response(JSON.stringify({ statusCode: 400, message: msg, error: 'Bad Request' }), { status: 400, headers: { 'content-type': 'application/json' } }));
  const res = await csvResponse('transactions', new URLSearchParams('from=2026-10-01&to=2026-10-31'), 'tok', f.fn, 'http://backend');
  assert.equal(res.status, 400);
  assert.equal(await res.text(), msg);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a backend that cannot be reached, or answers something not CSV, gives no file', async () => {
  const down = (async () => { throw new Error('ECONNREFUSED 10.0.0.1:3000'); }) as unknown as typeof fetch;
  const res = await csvResponse('finance', new URLSearchParams('from=2026-11-01&to=2026-11-02'), 'tok', down, 'http://backend');
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /10\.0\.0\.1|ECONN/);
  const html = fakeFetch(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal((await csvResponse('finance', new URLSearchParams('from=2026-11-01&to=2026-11-02'), 'tok', html.fn, 'http://backend')).status, 502);
});

// ---------------------------------------------------------------- days, pages, labels

test('days are shown from the backend\'s YYYY-MM-DD by text, never through the portal\'s clock', () => {
  assert.equal(dayLabel('2026-11-09'), '9 Nov 2026');
  assert.equal(dayLabel('2026-01-01'), '1 Jan 2026');
  assert.equal(rangeLabel({ from: '2026-11-09', to: '2026-11-09' }), '9 Nov 2026');
  assert.equal(rangeLabel({ from: '2026-11-01', to: '2026-11-09' }), '1 Nov 2026 to 9 Nov 2026');
  assert.equal(dayLabel('not-a-day'), 'not-a-day');
});

test('numbered pages keep the filters and say where the reader is', () => {
  const l = pageLinks('/transactions', { q: 'K7', page: '2' }, { page: 2, pageSize: 50, total: 120 });
  assert.equal(l.label, 'Page 2 of 3 (120 rows)');
  assert.equal(l.prev, '/transactions?q=K7&page=1');
  assert.equal(l.next, '/transactions?q=K7&page=3');
  const last = pageLinks('/audit', {}, { page: 1, pageSize: 50, total: 0 });
  assert.equal(last.label, 'Page 1 of 1 (0 rows)');
  assert.equal(last.prev, null);
  assert.equal(last.next, null);
});

test('every ticket state and incomplete status has a plain label', () => {
  for (const s of ['UNPAID', 'PAID', 'VALIDATED', 'EXPIRED']) assert.ok(STATE_LABELS[s as keyof typeof STATE_LABELS]);
  assert.match(INCOMPLETE_LABELS.IN_PROGRESS, /in progress/i);
  assert.match(INCOMPLETE_LABELS.NEVER_VALIDATED, /never validated/i);
});
