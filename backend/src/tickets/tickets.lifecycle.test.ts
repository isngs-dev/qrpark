import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { TEST_CATEGORY, as, ensureCategory, makeTicket, moveOperator, newKey, siteCounts } from '../test-support/tickets';
import { addOperator } from '../test-support/scans';
import { TICKET_NUMBER_PATTERN, TOKEN_PATTERN } from './ticket-codes';
import { TicketsService } from './tickets.service';

/**
 * Entry: POST /tickets, GET /tickets/recent, GET /tickets/lookup and
 * POST /tickets/reprint. Booted with captureLogs: the last test proves no
 * token reached a log line. See docs/api.md, "Entry".
 */

let t: TestApp;
const tokens: string[] = [];
before(async () => {
  t = await bootTestApp({ captureLogs: true });
  await ensureCategory(t);
  await ensureCategory(t, 'TVAN', 70_000);
});
after(() => t?.close());

const create = (body: unknown, opts: { user?: string; device?: string | null; rawBody?: string } = {}) =>
  as(t, opts.user ?? t.users.entry.id, 'POST', '/tickets', body, opts);

// ------------------------------------------------------------------ create

test('create: UNPAID, NOT_VALIDATED, fee snapshot from the backend, valid until the end of the Lagos day, token to print', async () => {
  const res = await create({ categoryCode: 'tcar', idempotencyKey: newKey() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  tokens.push(res.body.token);
  assert.match(res.body.token, TOKEN_PATTERN);
  assert.match(res.body.ticketNumber, TICKET_NUMBER_PATTERN);
  assert.equal(res.body.categoryCode, TEST_CATEGORY);
  assert.equal(res.body.feeKobo, 50_000);
  assert.equal(res.body.paymentStatus, 'UNPAID');
  assert.equal(res.body.validationStatus, 'NOT_VALIDATED');
  assert.deepEqual(res.body.gate, { code: 'ENTRY_1', name: 'Entry 1' });

  const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(row.operatorId, t.users.entry.id);
  assert.equal(row.gateId, t.entryGateId);
  assert.equal(row.deviceRef, 'test-device-1');
  const [{ end }] = await t.prisma.$queryRawUnsafe<Array<{ end: Date }>>(`SELECT lagos_day_end(now()) AS end`);
  assert.equal(row.validUntil.getTime(), end.getTime(), 'valid_until is not the end of today in Lagos');
  assert.equal(new Date(res.body.validUntil).getTime(), end.getTime());
});

test('entry double tap: the same key returns the same ticket; a new key gives a new ticket', async () => {
  const key = newKey();
  const first = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key });
  const again = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.token, first.body.token);
  const other = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() });
  assert.equal(other.status, 201);
  assert.notEqual(other.body.id, first.body.id);
  tokens.push(first.body.token, other.body.token);
});

test('entry double tap at the same moment: five taps with one key make one ticket', async () => {
  const key = newKey();
  const before = (await siteCounts(t)).ticket;
  const results = await Promise.all(Array.from({ length: 5 }, () => create({ categoryCode: TEST_CATEGORY, idempotencyKey: key })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal((await siteCounts(t)).ticket, before + 1);
  tokens.push(results[0].body.token);
});

test('a tap that misses the first replay (the other tap is still writing) gets the same ticket, not an error', async () => {
  // Deterministic stand-in for two taps crossing: the first tap commits, and
  // the second tap's FIRST replay is made to miss, as if it had looked a
  // moment earlier. Its insert then hits the key's unique index and must
  // answer with the existing ticket.
  const svc = t.app.get(TicketsService) as unknown as { replay: (...a: unknown[]) => Promise<unknown> };
  const original = svc.replay;
  const key = newKey();
  const first = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key });
  tokens.push(first.body.token);
  let calls = 0;
  svc.replay = async (...a: unknown[]) => (++calls === 1 ? null : original.apply(svc, a));
  try {
    const second = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.id, first.body.id);
  } finally {
    svc.replay = original;
  }
});

test('the key belongs to its request: another operator, or another category, is 409 and learns nothing', async () => {
  const key = newKey();
  const mine = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key });
  tokens.push(mine.body.token);
  const entry2 = await addOperator(t, 'entry.two', 'ENTRY_OPERATOR', t.entryGateId);
  const theirs = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: key }, { user: entry2.id });
  assert.equal(theirs.status, 409);
  assert.ok(!JSON.stringify(theirs.body).includes(mine.body.id) && !JSON.stringify(theirs.body).includes(mine.body.token));
  const changed = await create({ categoryCode: 'TVAN', idempotencyKey: key });
  assert.equal(changed.status, 409);
});

test('the app sends a category code, never a price, name or time: any other field is 400 and nothing is written', async () => {
  const before = await siteCounts(t);
  for (const extra of [{ feeKobo: 1 }, { customerName: 'Ada' }, { issuedAt: '2026-01-01T00:00:00Z' }, { validUntil: '2099-01-01T00:00:00Z' }]) {
    const res = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey(), ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
  }
  assert.deepEqual(await siteCounts(t), before);
});

test('a price change never changes a ticket already issued', async () => {
  const res = await create({ categoryCode: 'TVAN', idempotencyKey: newKey() });
  tokens.push(res.body.token);
  await t.prisma.vehicleCategory.update({ where: { siteId_code: { siteId: t.siteId, code: 'TVAN' } }, data: { priceKobo: 99_000 } });
  const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(row.feeKobo, 70_000);
  await t.prisma.vehicleCategory.update({ where: { siteId_code: { siteId: t.siteId, code: 'TVAN' } }, data: { priceKobo: 70_000 } });
});

test('unknown category 404, retired 400, bad key 400; nothing written', async () => {
  await t.prisma.vehicleCategory.upsert({
    where: { siteId_code: { siteId: t.siteId, code: 'TOLD' } },
    create: { siteId: t.siteId, code: 'TOLD', name: 'Old', priceKobo: 1, isActive: false },
    update: {},
  });
  const before = await siteCounts(t);
  assert.equal((await create({ categoryCode: 'NOPE', idempotencyKey: newKey() })).status, 404);
  assert.equal((await create({ categoryCode: 'TOLD', idempotencyKey: newKey() })).status, 400);
  assert.equal((await create({ categoryCode: TEST_CATEGORY, idempotencyKey: 'short' })).status, 400);
  assert.deepEqual(await siteCounts(t), before);
});

test('X-Device-Id is required: 400, nothing written, value not echoed', async () => {
  const before = await siteCounts(t);
  for (const device of [null, '', 'has space', 'x'.repeat(65), 'bad <value>']) {
    const res = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() }, { device });
    assert.equal(res.status, 400);
    if (device) assert.ok(!JSON.stringify(res.body).includes(device));
  }
  assert.deepEqual(await siteCounts(t), before);
});

test('only an ENTRY operator at an in-service ENTRY gate creates tickets; nothing written otherwise', async () => {
  const before = await siteCounts(t);
  const booth2 = await t.prisma.gate.create({ data: { siteId: t.siteId, code: 'TB_ENTRYTEST', name: 'x', direction: 'BOOTH' } });
  await moveOperator(t, t.users.entry.id, booth2.id);
  try {
    assert.equal((await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() })).status, 400, 'entry operator at a booth');
  } finally {
    await moveOperator(t, t.users.entry.id, t.entryGateId);
  }
  await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: false } });
  try {
    assert.equal((await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() })).status, 400, 'gate out of service');
  } finally {
    await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: true } });
  }
  for (const user of [t.users.booth.id, t.users.exit.id, t.users.admin.id]) {
    assert.equal((await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() }, { user })).status, 403);
  }
  assert.deepEqual(await siteCounts(t), before);
});

test('malformed JSON on POST /tickets echoes nothing', async () => {
  const res = await create(undefined, { rawBody: '{"categoryCode": "TCAR", "idempotencyKey": "abc' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { statusCode: 400, message: 'The request body is not valid JSON', error: 'Bad Request' });
});

// ------------------------------------------------------------------ recent

test("recent: the operator's own tickets of TODAY, newest first, never a token", async () => {
  const mine = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() });
  tokens.push(mine.body.token);
  const old = await makeTicket(t, { issuedAt: '2026-11-01T10:00:00Z' });
  const entry3 = await addOperator(t, 'entry.three', 'ENTRY_OPERATOR', t.entryGateId);
  const theirs = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() }, { user: entry3.id });
  tokens.push(theirs.body.token);

  const res = await as(t, t.users.entry.id, 'GET', '/tickets/recent');
  assert.equal(res.status, 200);
  const ids = res.body.map((r: { id: string }) => r.id);
  assert.equal(ids[0], mine.body.id);
  assert.ok(!ids.includes(old.id), 'an earlier-day ticket is listed');
  assert.ok(!ids.includes(theirs.body.id), "another operator's ticket is listed");
  const text = JSON.stringify(res.body);
  for (const token of tokens) assert.ok(!text.includes(token), 'the recent list carries a token');
  assert.ok(!('token' in res.body[0]));
});

// ------------------------------------------------------------------ lookup

test('lookup by trailing characters: today only, normalised input, at most 20, never a token', async () => {
  const today = await makeTicket(t, { ticketNumber: 'ZZZQ-7KMN' });
  const alsoToday = await makeTicket(t, { ticketNumber: 'AAAA-27KM' }); // ends in 7KM? no: ends "27KM"
  const yesterday = await makeTicket(t, { ticketNumber: 'YYYQ-7KMN', issuedAt: '2026-11-01T10:00:00Z' });
  tokens.push(today.token, alsoToday.token, yesterday.token);

  for (const suffix of ['7KMN', '7kmn', 'Q-7KMN', 'q7kmn', ' 7KMN ']) {
    const res = await as(t, t.users.booth.id, 'GET', `/tickets/lookup?suffix=${encodeURIComponent(suffix)}`);
    assert.equal(res.status, 200, `${suffix}: ${JSON.stringify(res.body)}`);
    const numbers = res.body.map((r: { ticketNumber: string }) => r.ticketNumber);
    assert.ok(numbers.includes('ZZZQ-7KMN'), `${suffix} missed today's ticket`);
    assert.ok(!numbers.includes('YYYQ-7KMN'), `${suffix} returned an earlier-day ticket`);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(today.token) && !text.includes(yesterday.token), 'lookup returned a token');
  }

  for (let i = 0; i < 25; i++) await makeTicket(t, { ticketNumber: `C${'ABCDEFGHJKMNPQRSTUVWXYZ23'[i]}DD-2WWW` });
  const many = await as(t, t.users.entry.id, 'GET', '/tickets/lookup?suffix=2WWW');
  assert.equal(many.status, 200);
  assert.equal(many.body.length, 20);
});

test('lookup: every miss is the same 404 (no match, too short, bad characters, another day)', async () => {
  await makeTicket(t, { ticketNumber: 'PPPP-9XRT', issuedAt: '2026-11-01T10:00:00Z' });
  const misses = await Promise.all(
    ['9XRT', 'XRT0', 'XR', '', 'ab$d', '9XRTPPPPPPPPP'].map((s) => as(t, t.users.entry.id, 'GET', `/tickets/lookup?suffix=${encodeURIComponent(s)}`)),
  );
  for (const res of misses) assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(new Set(misses.map((r) => JSON.stringify(r.body))).size, 1, 'different 404 bodies');
  assert.equal((await as(t, t.users.exit.id, 'GET', '/tickets/lookup?suffix=9XRT')).status, 403, 'exit operators cannot look up by number');
});

// ------------------------------------------------------------------ reprint

test('reprint: today and not validated only; the same QR; audited with actor and issuer; any entry operator', async () => {
  const made = await create({ categoryCode: TEST_CATEGORY, idempotencyKey: newKey() });
  tokens.push(made.body.token);
  const colleague = await addOperator(t, 'entry.four', 'ENTRY_OPERATOR', t.entryGateId);
  const res = await as(t, colleague.id, 'POST', '/tickets/reprint', { ticketId: made.body.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.token, made.body.token);
  const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { siteId: t.siteId, action: 'TICKET_REPRINTED', targetId: made.body.id } });
  assert.equal(audit.actorId, colleague.id);
  assert.deepEqual(audit.detail, { ticketNumber: made.body.ticketNumber, issuedBy: { id: t.users.entry.id, username: t.users.entry.username } });
  assert.ok(!JSON.stringify(audit).includes(made.body.token));

  // Paid still reprints (not validated); the booth role cannot.
  const paid = await makeTicket(t, { paid: 'CASH' });
  tokens.push(paid.token);
  assert.equal((await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: paid.id })).status, 200);
  assert.equal((await as(t, t.users.booth.id, 'POST', '/tickets/reprint', { ticketId: paid.id })).status, 403);
});

test('reprint: validated, another day, unknown and malformed are the same 404, and nothing is audited', async () => {
  const validated = await makeTicket(t, { paid: 'CASH', validated: true });
  const old = await makeTicket(t, { issuedAt: '2026-11-01T10:00:00Z' });
  tokens.push(validated.token, old.token);
  const audits = await t.prisma.auditLog.count({ where: { siteId: t.siteId, action: 'TICKET_REPRINTED' } });
  const misses = [
    await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: validated.id }),
    await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: old.id }),
    await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: '00000000-0000-4000-8000-000000000000' }),
    await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketId: 'not-a-uuid' }),
  ];
  for (const res of misses) assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(new Set(misses.map((r) => JSON.stringify(r.body))).size, 1);
  assert.ok(!JSON.stringify(misses).includes(validated.token) && !JSON.stringify(misses).includes(old.token));
  assert.equal(await t.prisma.auditLog.count({ where: { siteId: t.siteId, action: 'TICKET_REPRINTED' } }), audits);
  assert.equal((await as(t, t.users.entry.id, 'POST', '/tickets/reprint', { ticketNumber: 'ABCD-EFGH' })).status, 400, 'reprint takes ticketId only');
});

// ------------------------------------------------------------------- logs

test('no log line holds a token from these endpoints', async () => {
  assert.ok(t.logs.length > 0, 'nothing was captured');
  assert.ok(tokens.length >= 8);
  const all = t.logs.join('\n');
  for (const token of tokens) assert.ok(!all.includes(token.slice(0, 16)), 'a log line contains a token');
});
