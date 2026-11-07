import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { CHECKOUT_PREFIX, acceptedInit, postWebhook, successData } from '../test-support/paystack';
import { addBoothOperator, agePayment, clearPending, getPayment, newKey, startCard } from '../test-support/payments';
import { makeTicket, moveOperator, siteCounts } from '../test-support/tickets';
import { PAYMENT_REFERENCE_PATTERN } from '../tickets/ticket-codes';

/**
 * Card at the booth: POST /payments/card against a ticket, GET /payments/:id,
 * and GET /categories (entry). Paystack is the fake. See docs/api.md, "Booth".
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp();
  await t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code: 'CAR', name: 'Car', priceKobo: 50_000 } });
  await t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code: 'SUV', name: 'Suv', priceKobo: 70_000 } });
  await t.prisma.vehicleCategory.create({ data: { siteId: t.siteId, code: 'OLD', name: 'Old', priceKobo: 10_000, isActive: false } });
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await t.prisma.payment.updateMany({ where: { siteId: t.siteId, status: 'PENDING' }, data: { status: 'ABANDONED' } });
  t.paystack.onInitialize = acceptedInit;
  t.paystack.configured = true;
  t.paystack.initCalls.length = 0;
  t.paystack.verifyCalls.length = 0;
});

const booth = () => t.users.booth.id;

// ------------------------------------------------------------- categories

test('GET /categories (entry): active categories with their backend price, nothing else', async () => {
  const res = await call(t, 'GET', '/categories', { token: await t.accessToken(t.users.entry.id) });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.filter((c: { code: string }) => ['CAR', 'SUV', 'OLD'].includes(c.code)),
    [
      { code: 'CAR', name: 'Car', priceKobo: 50_000 },
      { code: 'SUV', name: 'Suv', priceKobo: 70_000 },
    ],
  );
});

// ------------------------------------------------------------- start

test("start: PENDING card payment for exactly the ticket's fee, Paystack checkout returned", async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { token: tk.token });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.method, 'CARD');
  assert.equal(res.body.status, 'PENDING');
  assert.equal(res.body.amountKobo, tk.feeKobo);
  assert.match(res.body.reference, PAYMENT_REFERENCE_PATTERN);
  assert.equal(res.body.authorizationUrl, `${CHECKOUT_PREFIX}${res.body.reference}`);
  assert.equal(res.body.ticket.id, tk.id);
  assert.equal(res.body.ticket.paymentStatus, 'UNPAID');
  assert.ok(!JSON.stringify(res.body).includes(tk.token), 'the payment carries the token');

  assert.deepEqual(t.paystack.initCalls, [{ reference: res.body.reference, amountKobo: tk.feeKobo, email: 'walkin@gsds.com.ng' }]);
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(row.ticketId, tk.id);
  assert.equal(row.operatorId, booth());
  assert.equal(row.gateId, t.boothGateId);
  assert.equal(row.deviceRef, 'test-device-1');
});

test('nothing about money comes from the client: an amount field is 400 and Paystack is not called', async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id, amountKobo: 1 } as never);
  assert.equal(res.status, 400);
  assert.equal(t.paystack.initCalls.length, 0);
});

test('double tap: the same key returns the same payment; Paystack is called once', async () => {
  const tk = await makeTicket(t);
  const key = newKey();
  const first = await startCard(t, booth(), { ticketId: tk.id, idempotencyKey: key });
  const again = await startCard(t, booth(), { ticketId: tk.id, idempotencyKey: key });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(t.paystack.initCalls.length, 1);
});

test('the key belongs to its request: another operator, or another ticket, is 409 and learns nothing', async () => {
  const tk = await makeTicket(t);
  const other = await makeTicket(t);
  const key = newKey();
  const mine = await startCard(t, booth(), { ticketId: tk.id, idempotencyKey: key });
  const booth2 = await addBoothOperator(t, 'booth.keytest');
  const theirs = await startCard(t, booth2.id, { ticketId: tk.id, idempotencyKey: key });
  assert.equal(theirs.status, 409);
  assert.ok(!JSON.stringify(theirs.body).includes(mine.body.reference));
  await clearPending(t, booth());
  const changed = await startCard(t, booth(), { ticketId: other.id, idempotencyKey: key });
  assert.equal(changed.status, 409);
});

test('one PENDING card payment per ticket: another booth operator gets 409 naming it', async () => {
  const tk = await makeTicket(t);
  const first = await startCard(t, booth(), { ticketId: tk.id });
  const booth2 = await addBoothOperator(t, 'booth.pending');
  const second = await startCard(t, booth2.id, { ticketId: tk.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.pendingPaymentId, first.body.id);
  assert.equal(t.paystack.initCalls.length, 1);
  await clearPending(t, booth2.id);
});

test('one PENDING card payment per operator: the same operator on another ticket gets 409', async () => {
  const a = await makeTicket(t);
  const b = await makeTicket(t);
  const first = await startCard(t, booth(), { ticketId: a.id });
  const second = await startCard(t, booth(), { ticketId: b.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.pendingPaymentId, first.body.id);
});

test('five taps with different keys at the same moment: one card payment, Paystack called once', async () => {
  const tk = await makeTicket(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => startCard(t, booth(), { ticketId: tk.id })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.prisma.payment.count({ where: { ticketId: tk.id, status: 'PENDING' } }), 1);
  assert.equal(t.paystack.initCalls.length, 1);
});

test('the booth refuses an expired, a paid and a validated ticket: 409, nothing written, Paystack not called', async () => {
  const expired = await makeTicket(t, { issuedAt: '2026-11-01T10:00:00Z' });
  const paid = await makeTicket(t, { paid: 'CASH' });
  const validated = await makeTicket(t, { paid: 'CASH', validated: true });
  const before = await siteCounts(t);
  for (const [tk, why] of [[expired, /expired/i], [paid, /already paid/i], [validated, /already been used|already paid/i]] as const) {
    const res = await startCard(t, booth(), { ticketId: tk.id });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, why);
  }
  assert.deepEqual(await siteCounts(t), before);
  assert.equal(t.paystack.initCalls.length, 0);
});

test('only a PAYMENT operator at an in-service BOOTH starts card payments; nothing written otherwise', async () => {
  const tk = await makeTicket(t);
  const before = await siteCounts(t);
  for (const user of [t.users.entry.id, t.users.exit.id, t.users.admin.id]) {
    assert.equal((await startCard(t, user, { ticketId: tk.id })).status, 403);
  }
  await moveOperator(t, booth(), t.exitGateId);
  try {
    assert.equal((await startCard(t, booth(), { ticketId: tk.id })).status, 400, 'payment operator at an exit gate');
  } finally {
    await moveOperator(t, booth(), t.boothGateId);
  }
  assert.equal((await startCard(t, booth(), { ticketId: tk.id }, { device: null })).status, 400, 'no X-Device-Id');
  assert.deepEqual(await siteCounts(t), before);
  assert.equal(t.paystack.initCalls.length, 0);
});

// ------------------------------------------------- Paystack's answers

test('Paystack refuses: the payment is ABANDONED at once (502), and the booth can start again', async () => {
  const tk = await makeTicket(t);
  t.paystack.onInitialize = () => ({ outcome: 'refused', authorizationUrl: null, accessCode: null, message: 'Invalid key' });
  const refused = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(refused.status, 502);
  assert.equal((await t.prisma.payment.findUniqueOrThrow({ where: { id: refused.body.paymentId } })).status, 'ABANDONED');
  t.paystack.onInitialize = acceptedInit;
  assert.equal((await startCard(t, booth(), { ticketId: tk.id })).status, 201);
});

test('Paystack does not answer: 503 with the payment id; it stays PENDING and blocks a second charge', async () => {
  const tk = await makeTicket(t);
  t.paystack.onInitialize = () => ({ outcome: 'unknown', authorizationUrl: null, accessCode: null, message: 'timeout' });
  const unknown = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(unknown.status, 503);
  assert.equal(unknown.body.outcome, 'unknown');
  assert.equal((await t.prisma.payment.findUniqueOrThrow({ where: { id: unknown.body.paymentId } })).status, 'PENDING');
  t.paystack.onInitialize = acceptedInit;
  assert.equal((await startCard(t, booth(), { ticketId: tk.id })).status, 409);
});

test('Paystack not configured: 503 and nothing written', async () => {
  const tk = await makeTicket(t);
  t.paystack.configured = false;
  const before = await siteCounts(t);
  assert.equal((await startCard(t, booth(), { ticketId: tk.id })).status, 503);
  assert.deepEqual(await siteCounts(t), before);
});

test('a PENDING payment past the window is checked with Paystack first: ABANDONED, then a new one starts', async () => {
  const tk = await makeTicket(t);
  const old = await startCard(t, booth(), { ticketId: tk.id });
  await agePayment(t, old.body.id, 6);
  t.paystack.verifyAnswers.set(old.body.reference, { kind: 'abandoned', data: { reference: old.body.reference, status: 'abandoned' }, message: 'abandoned' });
  const next = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.ok(t.paystack.verifyCalls.includes(old.body.reference));
  assert.equal((await t.prisma.payment.findUniqueOrThrow({ where: { id: old.body.id } })).status, 'ABANDONED');
});

test('a PENDING payment past the window that Paystack says SUCCEEDED pays the ticket instead', async () => {
  const tk = await makeTicket(t);
  const old = await startCard(t, booth(), { ticketId: tk.id });
  await agePayment(t, old.body.id, 6);
  t.paystack.verifyAnswers.set(old.body.reference, { kind: 'success', data: successData({ reference: old.body.reference, amountKobo: tk.feeKobo }), message: 'success' });
  const next = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(next.status, 409, 'a second payment started for a ticket Paystack had just confirmed');
  assert.match(next.body.message, /already paid/i);
  assert.equal((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).paymentStatus, 'PAID');
});

// ------------------------------------------------------------ polling

test("GET /payments/:id: the operator's own payment only; the checkout only while PENDING; never the token", async () => {
  const tk = await makeTicket(t);
  const mine = await startCard(t, booth(), { ticketId: tk.id });
  const own = await getPayment(t, booth(), mine.body.id);
  assert.equal(own.status, 200);
  assert.equal(own.body.authorizationUrl, mine.body.authorizationUrl);
  const booth2 = await addBoothOperator(t, 'booth.poller');
  assert.equal((await getPayment(t, booth2.id, mine.body.id)).status, 404);
  assert.equal((await getPayment(t, booth(), '00000000-0000-4000-8000-000000000000')).status, 404);

  await postWebhook(t.url, { event: 'charge.success', data: successData({ reference: mine.body.reference, amountKobo: tk.feeKobo }) });
  const paid = await getPayment(t, booth(), mine.body.id);
  assert.equal(paid.body.status, 'SUCCESS');
  assert.equal(paid.body.authorizationUrl, null);
  assert.equal(paid.body.ticket.paymentStatus, 'PAID');
  assert.ok(!JSON.stringify(paid.body).includes(tk.token));
});

test('the old POST /payments is gone', async () => {
  const res = await call(t, 'POST', '/payments', { token: await t.accessToken(booth()), body: {} });
  assert.equal(res.status, 404);
});
