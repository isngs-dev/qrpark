import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { CHECKOUT_PREFIX, acceptedInit, postWebhook, successData } from '../test-support/paystack';
import {
  addCategory,
  addEntryOperator,
  agePayment,
  clearPending,
  getPayment,
  newKey,
  startPayment,
} from '../test-support/payments';
import { PAYMENT_REFERENCE_PATTERN } from '../tickets/ticket-codes';

/**
 * Taking a payment: GET /categories, POST /payments, GET /payments/:id.
 * Paystack is the fake. See docs/api.md, "Payments".
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp();
  await addCategory(t, 'CAR', 50_000);
  await addCategory(t, 'SUV', 70_000);
  await addCategory(t, 'OLD', 10_000, false);
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await clearPending(t, t.users.entry.id);
  t.paystack.onInitialize = acceptedInit;
  t.paystack.configured = true;
  t.paystack.initCalls.length = 0;
});

// ------------------------------------------------------------- categories

test('GET /categories: active categories with their backend price, nothing else', async () => {
  const res = await call(t, 'GET', '/categories', { token: await t.accessToken(t.users.entry.id) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    { code: 'CAR', name: 'Car', priceKobo: 50_000 },
    { code: 'SUV', name: 'Suv', priceKobo: 70_000 },
  ]);
});

// ------------------------------------------------------------- start

test('start: PENDING payment, price snapshot from the backend, Paystack checkout returned', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'car', customerName: '  Ada Obi ' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'PENDING');
  assert.equal(res.body.amountKobo, 50_000);
  assert.ok(Number.isInteger(res.body.amountKobo));
  assert.equal(res.body.categoryCode, 'CAR');
  assert.equal(res.body.categoryName, 'Car');
  assert.equal(res.body.customerName, 'Ada Obi');
  assert.match(res.body.reference, PAYMENT_REFERENCE_PATTERN);
  assert.equal(res.body.authorizationUrl, `${CHECKOUT_PREFIX}${res.body.reference}`);
  assert.equal(typeof res.body.accessCode, 'string');
  assert.equal(res.body.ticket, null);

  // What Paystack was asked for: our amount in kobo, our reference, the walk-in email.
  assert.equal(t.paystack.initCalls.length, 1);
  assert.deepEqual(t.paystack.initCalls[0], {
    reference: res.body.reference,
    amountKobo: 50_000,
    email: 'walkin@gsds.com.ng',
  });

  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(row.operatorId, t.users.entry.id);
  assert.equal(row.gateId, t.entryGateId);
  assert.equal(row.amountKobo, 50_000);
  assert.equal(await t.prisma.ticket.count({ where: { paymentId: row.id } }), 0, 'a ticket exists for a PENDING payment');
});

test('the app sends a category code, never a price: a price field is refused', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', priceKobo: 1 } as never);
  assert.equal(res.status, 400);
  assert.equal(t.paystack.initCalls.length, 0);
});

test('double tap: the same idempotency key returns the same payment; Paystack is called once', async () => {
  const idempotencyKey = newKey();
  const first = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', idempotencyKey });
  const second = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', idempotencyKey });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.reference, first.body.reference);
  assert.equal(t.paystack.initCalls.length, 1);
});

test('idempotency key: reused by another operator is 409 and reveals nothing of the payment', async () => {
  const other = await addEntryOperator(t, 'entry.other');
  const idempotencyKey = newKey();
  const mine = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', idempotencyKey });
  const theirs = await startPayment(t, other.id, { categoryCode: 'CAR', idempotencyKey });
  assert.equal(theirs.status, 409);
  const text = JSON.stringify(theirs.body);
  assert.ok(!text.includes(mine.body.id) && !text.includes(mine.body.reference), 'leaked the other payment');
});

test('idempotency key: same key with a different request is 409', async () => {
  const idempotencyKey = newKey();
  await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', idempotencyKey });
  const changed = await startPayment(t, t.users.entry.id, { categoryCode: 'SUV', idempotencyKey });
  assert.equal(changed.status, 409);
});

test('idempotency key: a malformed key is 400', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', idempotencyKey: 'short' });
  assert.equal(res.status, 400);
});

test('no second payment while one is PENDING: 409 naming the pending payment', async () => {
  const first = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  const second = await startPayment(t, t.users.entry.id, { categoryCode: 'SUV' });
  assert.equal(second.status, 409);
  assert.equal(second.body.pendingPaymentId, first.body.id);
  assert.equal(t.paystack.initCalls.length, 1);
});

test('no second payment, even when two taps with different keys arrive at the same moment', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => startPayment(t, t.users.entry.id, { categoryCode: 'CAR' })),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.prisma.payment.count({ where: { operatorId: t.users.entry.id, status: 'PENDING' } }), 1);
  assert.equal(t.paystack.initCalls.length, 1, 'Paystack was asked for more than one charge');
});

test('a price change after the start does not change the payment, nor its ticket', async () => {
  const started = await startPayment(t, t.users.entry.id, { categoryCode: 'SUV' });
  assert.equal(started.body.amountKobo, 70_000);
  await t.prisma.vehicleCategory.update({
    where: { siteId_code: { siteId: t.siteId, code: 'SUV' } },
    data: { priceKobo: 99_000 },
  });
  const read = await getPayment(t, t.users.entry.id, started.body.id);
  assert.equal(read.body.amountKobo, 70_000);

  const hook = await postWebhook(t.url, { event: 'charge.success', data: successData({ reference: started.body.reference, amountKobo: 70_000 }) });
  assert.equal(hook.status, 200);
  const paid = await getPayment(t, t.users.entry.id, started.body.id);
  assert.equal(paid.body.status, 'SUCCESS');
  assert.equal(paid.body.ticket.amountKobo, 70_000);
  await t.prisma.vehicleCategory.update({
    where: { siteId_code: { siteId: t.siteId, code: 'SUV' } },
    data: { priceKobo: 70_000 },
  });
});

test('an unknown or retired category is refused, and Paystack is not called', async () => {
  assert.equal((await startPayment(t, t.users.entry.id, { categoryCode: 'NOPE' })).status, 404);
  assert.equal((await startPayment(t, t.users.entry.id, { categoryCode: 'OLD' })).status, 400);
  assert.equal(t.paystack.initCalls.length, 0);
});

test("an operator whose gate is out of service cannot take payments", async () => {
  await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: false } });
  try {
    const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
    assert.equal(res.status, 400);
    assert.equal(t.paystack.initCalls.length, 0);
  } finally {
    await t.prisma.gate.update({ where: { id: t.entryGateId }, data: { isActive: true } });
  }
});

test('customer name over 100 characters is 400', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR', customerName: 'x'.repeat(101) });
  assert.equal(res.status, 400);
});

// ------------------------------------------------- Paystack's answers

test('Paystack refuses: the payment is ABANDONED at once (502), and the operator can start again', async () => {
  t.paystack.onInitialize = () => ({ outcome: 'refused', authorizationUrl: null, accessCode: null, message: 'Invalid key' });
  const refused = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(refused.status, 502);
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: refused.body.paymentId } });
  assert.equal(row.status, 'ABANDONED');

  t.paystack.onInitialize = acceptedInit;
  const again = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(again.status, 201);
});

test('Paystack does not answer: 503 with the payment id; it stays PENDING and blocks a second charge', async () => {
  t.paystack.onInitialize = () => ({ outcome: 'unknown', authorizationUrl: null, accessCode: null, message: 'timeout' });
  const unknown = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(unknown.status, 503);
  assert.equal(unknown.body.outcome, 'unknown');
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: unknown.body.paymentId } });
  assert.equal(row.status, 'PENDING', 'an unknown outcome was treated as a refusal');

  t.paystack.onInitialize = acceptedInit;
  const second = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(second.status, 409);
});

test('Paystack not configured: 503 and nothing written', async () => {
  t.paystack.configured = false;
  const before = await t.prisma.payment.count({ where: { siteId: t.siteId } });
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 503);
  assert.equal(await t.prisma.payment.count({ where: { siteId: t.siteId } }), before);
});

test('a PENDING payment past the window stops blocking: checked with Paystack, ABANDONED, new one starts', async () => {
  const old = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  await agePayment(t, old.body.id, 6); // window is 5 minutes
  t.paystack.verifyAnswers.set(old.body.reference, { kind: 'abandoned', data: { reference: old.body.reference, status: 'abandoned' }, message: 'abandoned' });

  const next = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.ok(t.paystack.verifyCalls.includes(old.body.reference), 'the old payment was not checked with Paystack first');
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: old.body.id } });
  assert.equal(row.status, 'ABANDONED');
});

test('a PENDING payment past the window that Paystack says SUCCEEDED gets its ticket instead', async () => {
  const old = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  await agePayment(t, old.body.id, 6);
  t.paystack.verifyAnswers.set(old.body.reference, {
    kind: 'success',
    data: successData({ reference: old.body.reference, amountKobo: 50_000 }),
    message: 'success',
  });
  const next = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(next.status, 201);
  const paid = await getPayment(t, t.users.entry.id, old.body.id);
  assert.equal(paid.body.status, 'SUCCESS');
  assert.ok(paid.body.ticket);
});

// ------------------------------------------------------------ polling

test('GET /payments/:id: the operator\'s own payment only; anyone else gets 404', async () => {
  const mine = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  const own = await getPayment(t, t.users.entry.id, mine.body.id);
  assert.equal(own.status, 200);
  assert.equal(own.body.status, 'PENDING');
  assert.equal(own.body.authorizationUrl, mine.body.authorizationUrl);

  const other = await addEntryOperator(t, 'entry.poller');
  assert.equal((await getPayment(t, other.id, mine.body.id)).status, 404);
  assert.equal((await getPayment(t, t.users.entry.id, '00000000-0000-4000-8000-000000000000')).status, 404);
});

test('GET /payments/:id: no checkout link once the payment is not PENDING', async () => {
  const started = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  await postWebhook(t.url, { event: 'charge.success', data: successData({ reference: started.body.reference, amountKobo: 50_000 }) });
  const paid = await getPayment(t, t.users.entry.id, started.body.id);
  assert.equal(paid.body.status, 'SUCCESS');
  assert.equal(paid.body.authorizationUrl, null);
  assert.equal(paid.body.accessCode, null);
});
