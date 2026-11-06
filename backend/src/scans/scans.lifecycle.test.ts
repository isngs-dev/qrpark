import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp, type TestUser } from '../test-support/app';
import { fakeToken } from '../test-support/db';
import { DEVICE, addOperator, issueTicket, scan, siteCounts, ticketRow } from '../test-support/scans';
import { ScanStore } from './scan-store';

/**
 * POST /tickets/validate and POST /tickets/check over HTTP, against a real
 * database. Booted with captureLogs so the last tests can prove no scanned
 * token reaches a log line. See docs/api.md, "Scans".
 */

let t: TestApp;
let exit2: TestUser;
let store: ScanStore;
const seenTokens: string[] = [];

before(async () => {
  t = await bootTestApp({ captureLogs: true });
  store = t.app.get(ScanStore);
  exit2 = await addOperator(t, 'exit.two', 'EXIT_OPERATOR', t.exitGateId);
});
after(() => t?.close());

async function ticket(opts: { expired?: boolean } = {}) {
  const row = await issueTicket(t, opts);
  seenTokens.push(row.token);
  return row;
}

async function lastScan() {
  return t.prisma.scanEvent.findFirstOrThrow({ where: { siteId: t.siteId }, orderBy: { occurredAt: 'desc' } });
}

// ------------------------------------------------------------------ VALID

test('validate: VALID, the ticket is USED by this operator at this gate, on the database clock', async () => {
  const tk = await ticket();
  const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result, 'VALID');
  assert.deepEqual(Object.keys(res.body).sort(), ['result', 'scannedAt', 'ticket']);
  assert.deepEqual(res.body.ticket, {
    ticketNumber: tk.ticketNumber,
    categoryName: 'Car',
    customerName: 'Ada Obi',
    paidAt: tk.paidAt.toISOString(),
    validUntil: tk.validUntil.toISOString(),
  });

  const after = await ticketRow(t, tk.id);
  assert.equal(after.status, 'USED');
  assert.equal(after.usedGateId, t.exitGateId);
  assert.equal(after.usedById, t.users.exit.id);

  const event = await lastScan();
  assert.equal(event.ticketId, tk.id);
  assert.equal(event.kind, 'EXIT');
  assert.equal(event.result, 'VALID');
  assert.equal(event.gateId, t.exitGateId);
  assert.equal(event.operatorId, t.users.exit.id);
  assert.equal(event.deviceRef, DEVICE);
  // Same transaction, same now(): used_at and the scan time are one database instant.
  assert.equal(after.usedAt!.getTime(), event.occurredAt.getTime(), 'used_at is not the database time of the scan');
  assert.equal(res.body.scannedAt, event.occurredAt.toISOString());
  assert.ok(!JSON.stringify(res.body).includes(tk.token), 'the token was echoed');
});

// ----------------------------------------------------------- ALREADY_USED

test('validate twice: ALREADY_USED with when, which gate, which operator; usedByYou for the closer', async () => {
  const tk = await ticket();
  const first = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
  assert.equal(first.body.result, 'VALID');

  const mine = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.result, 'ALREADY_USED');
  const row = await ticketRow(t, tk.id);
  assert.equal(mine.body.usedAt, row.usedAt!.toISOString());
  assert.deepEqual(mine.body.usedGate, { code: 'EXIT_1', name: 'Exit 1' });
  assert.deepEqual(mine.body.usedBy, { name: t.users.exit.username, username: t.users.exit.username });
  assert.equal(mine.body.usedByYou, true, 'a retry after a lost reply must say the caller closed it');
  assert.equal(mine.body.ticket.ticketNumber, tk.ticketNumber);

  const theirs = await scan(t, 'validate', exit2.id, { token: tk.token });
  assert.equal(theirs.body.result, 'ALREADY_USED');
  assert.equal(theirs.body.usedByYou, false);

  const event = await lastScan();
  assert.equal(event.result, 'ALREADY_USED');
  assert.equal(event.ticketId, tk.id);
  assert.equal(event.operatorId, exit2.id);
});

test('a retry is never re-approved: ten more scans by the same operator are all ALREADY_USED', async () => {
  const tk = await ticket();
  assert.equal((await scan(t, 'validate', t.users.exit.id, { token: tk.token })).body.result, 'VALID');
  for (let i = 0; i < 10; i++) {
    const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
    assert.equal(res.body.result, 'ALREADY_USED');
    assert.equal(res.body.usedByYou, true);
  }
});

// ---------------------------------------------------------------- EXPIRED

test('validate: an expired ticket is EXPIRED with valid_until, and is not changed', async () => {
  const tk = await ticket({ expired: true });
  const before = await ticketRow(t, tk.id);
  const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
  assert.equal(res.body.result, 'EXPIRED');
  assert.equal(res.body.validUntil, tk.validUntil.toISOString());
  assert.deepEqual(await ticketRow(t, tk.id), before);
  const event = await lastScan();
  assert.equal(event.result, 'EXPIRED');
  assert.equal(event.ticketId, tk.id);
});

// ------------------------------------------------- NOT_FOUND, INVALID_QR

test('validate: a well-formed token with no ticket is NOT_FOUND, recorded with no ticket', async () => {
  const unknown = fakeToken();
  seenTokens.push(unknown);
  const res = await scan(t, 'validate', t.users.exit.id, { token: unknown });
  assert.deepEqual(Object.keys(res.body).sort(), ['result', 'scannedAt']);
  assert.equal(res.body.result, 'NOT_FOUND');
  const event = await lastScan();
  assert.equal(event.result, 'NOT_FOUND');
  assert.equal(event.ticketId, null);
});

test("a ticket from another site is NOT_FOUND here, and is not changed", async () => {
  const other = await bootTestApp();
  try {
    const foreign = await issueTicket(other);
    seenTokens.push(foreign.token);
    const res = await scan(t, 'validate', t.users.exit.id, { token: foreign.token });
    assert.equal(res.body.result, 'NOT_FOUND');
    assert.equal((await ticketRow(t, foreign.id)).status, 'ACTIVE');
  } finally {
    await other.close();
    process.env.SITE_CODE = t.siteCode;
  }
});

test('INVALID_QR: decided before any ticket lookup (no consume, no inspect), and still recorded', async () => {
  const calls = { consume: 0, inspect: 0, record: 0 };
  const original = { consume: store.consume, inspect: store.inspect, record: store.record };
  store.consume = async (...a) => (calls.consume++, original.consume.apply(store, a));
  store.inspect = async (...a) => (calls.inspect++, original.inspect.apply(store, a));
  store.record = async (...a) => (calls.record++, original.record.apply(store, a));
  try {
    for (const [route, user] of [['validate', t.users.exit.id], ['check', t.users.entry.id]] as const) {
      for (const bad of ['hello', `${fakeToken()}x`, `${fakeToken().slice(0, 42)}=`, 'K7MP-3QZ9', '']) {
        const res = await scan(t, route, user, { token: bad });
        assert.equal(res.status, 200, `${route} "${bad}": ${JSON.stringify(res.body)}`);
        assert.equal(res.body.result, 'INVALID_QR');
        const event = await lastScan();
        assert.equal(event.result, 'INVALID_QR');
        assert.equal(event.ticketId, null);
      }
    }
    assert.equal(calls.consume, 0, 'a malformed token reached consume()');
    assert.equal(calls.inspect, 0, 'a malformed token reached inspect()');
    assert.equal(calls.record, 10);
  } finally {
    Object.assign(store, original);
  }
});

test('the scanned text is trimmed first: a scanner newline does not make a valid QR invalid', async () => {
  const tk = await ticket();
  const res = await scan(t, 'check', t.users.entry.id, { token: `  ${tk.token}\r\n` });
  assert.equal(res.body.result, 'ACTIVE');
});

// ------------------------------------------------------------------ CHECK

test('check is read-only: the ticket row is identical and the only new row is one scan_event', async () => {
  for (const make of [() => ticket(), () => ticket({ expired: true })]) {
    const tk = await make();
    const rowBefore = await ticketRow(t, tk.id);
    const countsBefore = await siteCounts(t);
    for (const user of [t.users.entry.id, t.users.exit.id]) {
      const res = await scan(t, 'check', user, { token: tk.token });
      assert.equal(res.status, 200);
    }
    assert.deepEqual(await ticketRow(t, tk.id), rowBefore, 'check changed the ticket');
    assert.deepEqual(await siteCounts(t), { ...countsBefore, scanEvent: countsBefore.scanEvent + 2 });
  }
});

test('check: ACTIVE with validUntil, then ALREADY_USED and EXPIRED like validate; kind CHECK', async () => {
  const tk = await ticket();
  const active = await scan(t, 'check', t.users.entry.id, { token: tk.token });
  assert.equal(active.body.result, 'ACTIVE');
  assert.equal(active.body.ticket.validUntil, tk.validUntil.toISOString());
  const event = await lastScan();
  assert.equal(event.kind, 'CHECK');
  assert.equal(event.result, 'ACTIVE');
  assert.equal(event.gateId, t.entryGateId);

  await scan(t, 'validate', t.users.exit.id, { token: tk.token });
  const used = await scan(t, 'check', t.users.entry.id, { token: tk.token });
  assert.equal(used.body.result, 'ALREADY_USED');
  assert.deepEqual(used.body.usedGate, { code: 'EXIT_1', name: 'Exit 1' });
  assert.equal(used.body.usedByYou, false);

  const old = await ticket({ expired: true });
  const expired = await scan(t, 'check', t.users.exit.id, { token: old.token });
  assert.equal(expired.body.result, 'EXPIRED');
  assert.equal(expired.body.validUntil, old.validUntil.toISOString());

  const unknown = await scan(t, 'check', t.users.exit.id, { token: fakeToken() });
  assert.equal(unknown.body.result, 'NOT_FOUND');
});

// ------------------------------------------------------- gate and device

test('validate needs an in-service EXIT gate; check needs the gate matching the role; nothing written', async () => {
  const tk = await ticket();
  const counts = await siteCounts(t);

  await t.prisma.gate.update({ where: { id: t.exitGateId }, data: { isActive: false } });
  try {
    assert.equal((await scan(t, 'validate', t.users.exit.id, { token: tk.token })).status, 400);
    assert.equal((await scan(t, 'check', t.users.exit.id, { token: tk.token })).status, 400);
  } finally {
    await t.prisma.gate.update({ where: { id: t.exitGateId }, data: { isActive: true } });
  }
  await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: false } });
  try {
    assert.equal((await scan(t, 'check', t.users.entry.id, { token: tk.token })).status, 400);
  } finally {
    await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: true } });
  }

  // A gate facing the wrong way (only possible by editing the database).
  await t.prisma.$executeRawUnsafe(`UPDATE app_user SET gate_id = $1::uuid WHERE id = $2::uuid`, t.entryGateId, exit2.id);
  try {
    assert.equal((await scan(t, 'validate', exit2.id, { token: tk.token })).status, 400);
    assert.equal((await scan(t, 'check', exit2.id, { token: tk.token })).status, 400);
  } finally {
    await t.prisma.$executeRawUnsafe(`UPDATE app_user SET gate_id = $1::uuid WHERE id = $2::uuid`, t.exitGateId, exit2.id);
  }

  assert.deepEqual(await siteCounts(t), counts, 'a refused request wrote something');
  assert.equal((await ticketRow(t, tk.id)).status, 'ACTIVE');
});

test('missing or invalid X-Device-Id: 400, nothing written, header value not echoed', async () => {
  const tk = await ticket();
  const counts = await siteCounts(t);
  const badHeader = 'bad header value <script>';
  for (const device of [null, '', 'x'.repeat(65), badHeader, 'has space']) {
    const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token }, { device });
    assert.equal(res.status, 400, `device ${JSON.stringify(device)} answered ${res.status}`);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(tk.token), 'the token was echoed');
    if (device) assert.ok(!text.includes(device), 'the header value was echoed');
  }
  assert.deepEqual(await siteCounts(t), counts);
  assert.equal((await ticketRow(t, tk.id)).status, 'ACTIVE');
});

test('400 for a missing, non-string, oversized or unparseable token never echoes it', async () => {
  const tk = await ticket();
  const counts = await siteCounts(t);
  const oversized = `${tk.token}${'A'.repeat(2049)}`;
  const cases: Array<{ body?: unknown; rawBody?: string }> = [
    { body: {} },
    { body: { token: 12345 } },
    { body: { token: null } },
    { body: { token: [tk.token] } },
    { body: { token: oversized } },
    { body: { token: tk.token, extra: tk.token } },
    { rawBody: `{"token": "${tk.token}"` }, // not valid JSON
    { rawBody: `token=${tk.token}` },
    { rawBody: tk.token },
    { rawBody: `{"token": ${tk.token}}` },
  ];
  for (const c of cases) {
    const res = await scan(t, 'validate', t.users.exit.id, c.body, c.rawBody !== undefined ? { rawBody: c.rawBody } : {});
    assert.equal(res.status, 400, `${JSON.stringify(c).slice(0, 60)} answered ${res.status}`);
    const text = JSON.stringify(res.body);
    // Not even a fragment: no run of 6 token characters may come back
    // (the default JSON error quoted the first 10).
    for (let i = 0; i + 6 <= tk.token.length; i++) {
      assert.ok(!text.includes(tk.token.slice(i, i + 6)), `a 400 echoed part of the token: ${text.slice(0, 200)}`);
    }
  }
  assert.deepEqual(await siteCounts(t), counts, 'a 400 wrote something');
  assert.equal((await ticketRow(t, tk.id)).status, 'ACTIVE');
});

// ------------------------------------------- never VALID when unsure

test('validate: consume changed nothing but the ticket reads ACTIVE and valid -> 503 cannot verify, never VALID', async () => {
  const tk = await ticket();
  const original = store.consume;
  store.consume = async () => null;
  try {
    const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.notEqual(res.body?.result, 'VALID');
    assert.match(JSON.stringify(res.body), /cannot verify/i);
  } finally {
    store.consume = original;
  }
  assert.equal((await ticketRow(t, tk.id)).status, 'ACTIVE');
});

test('consume and the scan record are one transaction: a failed record leaves the ticket ACTIVE and answers 5xx', async () => {
  const tk = await ticket();
  const scansBefore = await t.prisma.scanEvent.count({ where: { siteId: t.siteId } });
  const original = store.record;
  store.record = async () => {
    throw new Error('forced failure writing the scan record');
  };
  try {
    const res = await scan(t, 'validate', t.users.exit.id, { token: tk.token });
    assert.ok(res.status >= 500, `answered ${res.status}`);
    assert.notEqual(res.body?.result, 'VALID');
  } finally {
    store.record = original;
  }
  const row = await ticketRow(t, tk.id);
  assert.equal(row.status, 'ACTIVE', 'the ticket was closed without a scan record');
  assert.equal(row.usedAt, null);
  assert.equal(await t.prisma.scanEvent.count({ where: { siteId: t.siteId } }), scansBefore);

  // And it can still be validated afterwards.
  assert.equal((await scan(t, 'validate', t.users.exit.id, { token: tk.token })).body.result, 'VALID');
});

// ------------------------------------------------------------------- logs

test('no log line holds a scanned token (every token used above, all results, 400s and 5xx)', async () => {
  assert.ok(t.logs.length > 0, 'nothing was captured, so this proves nothing');
  assert.ok(seenTokens.length >= 8);
  const all = t.logs.join('\n');
  for (const token of seenTokens) {
    assert.ok(!all.includes(token.slice(0, 16)), 'a log line contains a scanned token');
  }
  assert.ok(t.logs.some((l) => /EXIT VALID/.test(l)), 'scans are not logged at all (expected a token-free line)');
});
