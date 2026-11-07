import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bootTestApp, type TestApp } from '../test-support/app';
import { as, makeTicket, moveOperator, newKey, siteCounts } from '../test-support/tickets';
import { addOperator } from '../test-support/scans';
import { PaymentsService } from './payments.service';

/**
 * POST /payments/cash: one tap marks the ticket PAID. The amount is always
 * the ticket's fee. See docs/api.md, "Booth".
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp({ captureLogs: true });
});
after(() => t?.close());
beforeEach(async () => {
  if (t) await t.prisma.payment.updateMany({ where: { siteId: t.siteId, status: 'PENDING' }, data: { status: 'ABANDONED' } });
});

const cash = (body: unknown, opts: { user?: string; device?: string | null; rawBody?: string } = {}) =>
  as(t, opts.user ?? t.users.booth.id, 'POST', '/payments/cash', body, opts);

test('cash by scanned token: SUCCESS payment for exactly the fee, ticket PAID, audited', async () => {
  const tk = await makeTicket(t);
  const res = await cash({ token: tk.token, idempotencyKey: newKey() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.method, 'CASH');
  assert.equal(res.body.status, 'SUCCESS');
  assert.equal(res.body.amountKobo, tk.feeKobo);
  assert.equal(res.body.ticket.paymentStatus, 'PAID');
  assert.equal(res.body.ticket.paymentMethod, 'CASH');
  assert.ok(!JSON.stringify(res.body).includes(tk.token), 'the payment response carries the token');

  const ticket = await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
  assert.equal(ticket.paymentStatus, 'PAID');
  assert.equal(ticket.paidPaymentId, res.body.id);
  const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(payment.operatorId, t.users.booth.id);
  assert.equal(payment.gateId, t.boothGateId);
  assert.equal(payment.deviceRef, 'test-device-1');

  const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { siteId: t.siteId, action: 'PAYMENT_CASH_CONFIRMED', targetId: res.body.id } });
  assert.equal(audit.actorId, t.users.booth.id);
  assert.deepEqual(audit.detail, { ticketNumber: tk.ticketNumber, amountKobo: tk.feeKobo, reference: res.body.reference });
});

test('cash by ticket id (after a lookup) works the same', async () => {
  const tk = await makeTicket(t);
  const res = await cash({ ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(res.status, 201);
  assert.equal(res.body.ticket.id, tk.id);
});

test('cash double tap: the same key returns the same payment, also when the taps arrive at once', async () => {
  const tk = await makeTicket(t);
  const key = newKey();
  const first = await cash({ token: tk.token, idempotencyKey: key });
  const again = await cash({ token: tk.token, idempotencyKey: key });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);

  const tk2 = await makeTicket(t);
  const key2 = newKey();
  const taps = await Promise.all(Array.from({ length: 5 }, () => cash({ token: tk2.token, idempotencyKey: key2 })));
  assert.deepEqual(taps.map((r) => r.status).sort(), [200, 200, 200, 200, 201], JSON.stringify(taps.map((r) => r.body)));
  assert.equal(new Set(taps.map((r) => r.body.id)).size, 1);
  assert.equal(await t.prisma.payment.count({ where: { ticketId: tk2.id } }), 1, 'a double tap posted twice');
});

test('a tap that misses the first replay (the other tap was still writing) gets the same payment under the ticket lock', async () => {
  // Deterministic stand-in for two taps crossing: the first tap commits; the
  // second tap's first (unlocked) replay is made to miss. Under the ticket
  // lock it must find the payment and return it, not refuse "already paid".
  const svc = t.app.get(PaymentsService) as unknown as { replay: (...a: unknown[]) => Promise<unknown> };
  const original = svc.replay;
  const tk = await makeTicket(t);
  const key = newKey();
  const first = await cash({ token: tk.token, idempotencyKey: key });
  assert.equal(first.status, 201);
  let calls = 0;
  svc.replay = async (...a: unknown[]) => (++calls === 1 ? null : original.apply(svc, a));
  try {
    const second = await cash({ token: tk.token, idempotencyKey: key });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.id, first.body.id);
  } finally {
    svc.replay = original;
  }
});

test('a new key on a PAID ticket is refused: 409 "already paid", nothing written', async () => {
  const tk = await makeTicket(t);
  await cash({ token: tk.token, idempotencyKey: newKey() });
  const before = await siteCounts(t);
  const res = await cash({ token: tk.token, idempotencyKey: newKey() });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /already paid/i);
  assert.deepEqual(await siteCounts(t), before);
});

test('the booth refuses an expired and a validated ticket: 409, nothing written', async () => {
  const expired = await makeTicket(t, { issuedAt: '2026-11-01T10:00:00Z' });
  const validated = await makeTicket(t, { paid: 'CARD', validated: true });
  const before = await siteCounts(t);
  const e = await cash({ token: expired.token, idempotencyKey: newKey() });
  assert.equal(e.status, 409);
  assert.match(e.body.message, /expired/i);
  const v = await cash({ ticketId: validated.id, idempotencyKey: newKey() });
  assert.equal(v.status, 409);
  assert.match(v.body.message, /already been used|already paid/i);
  assert.deepEqual(await siteCounts(t), before);
});

test('cash while a card payment for the ticket is PENDING: 409 with pendingPaymentId, nothing written', async () => {
  const tk = await makeTicket(t);
  const card = await as(t, t.users.booth.id, 'POST', '/payments/card', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(card.status, 201, JSON.stringify(card.body));
  const booth2 = await addOperator(t, `booth.${randomBytes(3).toString('hex')}`, 'PAYMENT_OPERATOR', t.boothGateId);
  const before = await siteCounts(t);
  const res = await cash({ ticketId: tk.id, idempotencyKey: newKey() }, { user: booth2.id });
  assert.equal(res.status, 409);
  assert.equal(res.body.pendingPaymentId, card.body.id);
  assert.deepEqual(await siteCounts(t), before);
});

test('nothing about money comes from the client: an amount field is 400', async () => {
  const tk = await makeTicket(t);
  for (const extra of [{ amountKobo: 1 }, { feeKobo: 1 }, { method: 'CARD' }]) {
    const res = await cash({ token: tk.token, idempotencyKey: newKey(), ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
  }
  assert.equal((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).paymentStatus, 'UNPAID');
});

test('exactly one of token or ticketId; unknown or malformed ticket is the same 404', async () => {
  const tk = await makeTicket(t);
  assert.equal((await cash({ idempotencyKey: newKey() })).status, 400);
  assert.equal((await cash({ token: tk.token, ticketId: tk.id, idempotencyKey: newKey() })).status, 400);
  const misses = [
    await cash({ token: 'not-a-token', idempotencyKey: newKey() }),
    await cash({ token: randomBytes(32).toString('base64url'), idempotencyKey: newKey() }),
    await cash({ ticketId: '00000000-0000-4000-8000-000000000000', idempotencyKey: newKey() }),
  ];
  for (const r of misses) assert.equal(r.status, 404);
  assert.equal(new Set(misses.map((r) => JSON.stringify(r.body))).size, 1);
});

test('only a PAYMENT operator at an in-service BOOTH takes cash; nothing written otherwise', async () => {
  const tk = await makeTicket(t);
  const before = await siteCounts(t);
  for (const user of [t.users.entry.id, t.users.exit.id, t.users.admin.id]) {
    assert.equal((await cash({ token: tk.token, idempotencyKey: newKey() }, { user })).status, 403);
  }
  await moveOperator(t, t.users.booth.id, t.entryGateId);
  try {
    assert.equal((await cash({ token: tk.token, idempotencyKey: newKey() })).status, 400, 'payment operator at an entry gate');
  } finally {
    await moveOperator(t, t.users.booth.id, t.boothGateId);
  }
  await t.prisma.gate.update({ where: { id: t.boothGateId }, data: { isActive: false } });
  try {
    assert.equal((await cash({ token: tk.token, idempotencyKey: newKey() })).status, 400, 'booth out of service');
  } finally {
    await t.prisma.gate.update({ where: { id: t.boothGateId }, data: { isActive: true } });
  }
  assert.deepEqual(await siteCounts(t), before);
});

test('X-Device-Id required; malformed JSON echoes nothing', async () => {
  const tk = await makeTicket(t);
  for (const device of [null, '', 'bad value']) {
    const res = await cash({ token: tk.token, idempotencyKey: newKey() }, { device });
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(res.body).includes(tk.token));
  }
  const bad = await cash(undefined, { rawBody: `{"token": "${tk.token}"` });
  assert.equal(bad.status, 400);
  for (let i = 0; i + 6 <= tk.token.length; i++) assert.ok(!JSON.stringify(bad.body).includes(tk.token.slice(i, i + 6)));
  assert.equal((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).paymentStatus, 'UNPAID');
});

test('no log line holds a scanned token', async () => {
  const tk = await makeTicket(t);
  await cash({ token: tk.token, idempotencyKey: newKey() });
  assert.ok(t.logs.length > 0);
  assert.ok(!t.logs.join('\n').includes(tk.token.slice(0, 16)));
  assert.ok(t.logs.some((l) => l.includes('CASH')), 'cash confirmations are not logged at all (expected a token-free line)');
});
