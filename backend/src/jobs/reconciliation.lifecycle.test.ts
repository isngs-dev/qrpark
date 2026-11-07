import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { successData } from '../test-support/paystack';
import { addBoothOperator, agePayment, clearPending, startCard } from '../test-support/payments';
import { makeTicket, payRaw } from '../test-support/tickets';
import { ReconciliationService } from './reconciliation.service';

/**
 * The verify fallback (~20 s after a payment starts) and the sweep. Both
 * change a payment ONLY from Paystack's answer; the window alone never does.
 * Called directly: BullMQ is off in tests (DISABLE_JOBS=1).
 */

let t: TestApp;
let jobs: ReconciliationService;
before(async () => {
  t = await bootTestApp();
  jobs = t.app.get(ReconciliationService);
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await clearPending(t, t.users.booth.id);
  t.paystack.verifyAnswers.clear();
  t.paystack.verifyCalls.length = 0;
});

async function pending(opts: { checkout?: boolean } = {}) {
  if (opts.checkout === false) {
    t.paystack.onInitialize = () => ({ outcome: 'unknown', authorizationUrl: null, accessCode: null, message: 'timeout' });
  }
  const res = await startCard(t, t.users.booth.id, { ticketId: (await makeTicket(t)).id });
  t.paystack.onInitialize = (r) => ({ outcome: 'accepted', authorizationUrl: `https://checkout.paystack.test/${r.reference}`, accessCode: 'ac', message: 'ok' });
  const id = res.body.id ?? res.body.paymentId;
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id } });
  return row;
}

const answer = (reference: string, kind: 'success' | 'failed' | 'abandoned' | 'pending' | 'not_found' | 'unknown', data: Record<string, unknown> | null = null) =>
  t.paystack.verifyAnswers.set(reference, { kind, data: data ?? (kind === 'not_found' || kind === 'unknown' ? null : { reference, status: kind }), message: kind });

const status = async (id: string) => {
  const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id } });
  const ticket = await t.prisma.ticket.findUniqueOrThrow({ where: { id: payment.ticketId } });
  return { ...payment, paid: ticket.paymentStatus === 'PAID' };
};

test('verify: success -> SUCCESS and the ticket PAID', async () => {
  const p = await pending();
  answer(p.reference, 'success', successData({ reference: p.reference, amountKobo: p.amountKobo }));
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'SUCCESS');
  assert.equal(after.paid, true, 'the ticket is not PAID');
});

test('verify: success with the wrong amount -> unchanged, the ticket stays UNPAID', async () => {
  const p = await pending();
  answer(p.reference, 'success', successData({ reference: p.reference, amountKobo: 1 }));
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'PENDING');
  assert.equal(after.paid, false, 'the ticket was PAID');
});

test('verify: failed -> FAILED, the ticket stays UNPAID', async () => {
  const p = await pending();
  answer(p.reference, 'failed');
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'FAILED');
  assert.equal(after.paid, false, 'the ticket was PAID');
});

test('verify: "abandoned" inside the window stays PENDING (the customer may still be paying)', async () => {
  const p = await pending();
  answer(p.reference, 'abandoned');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'PENDING');
});

test('verify: "abandoned" past the window -> ABANDONED, the ticket stays UNPAID', async () => {
  const p = await pending();
  await agePayment(t, p.id, 6);
  answer(p.reference, 'abandoned');
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'ABANDONED');
  assert.equal(after.paid, false, 'the ticket was PAID');
});

test('verify: not found, and Paystack never gave us a checkout -> ABANDONED at once', async () => {
  const p = await pending({ checkout: false });
  assert.equal(p.authorizationUrl, null);
  answer(p.reference, 'not_found');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'ABANDONED');
});

test('verify: not found for a payment that has a checkout -> PENDING inside the window', async () => {
  const p = await pending();
  answer(p.reference, 'not_found');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'PENDING');
});

test('verify: no trustworthy answer changes nothing, even past the window', async () => {
  const p = await pending();
  await agePayment(t, p.id, 30);
  answer(p.reference, 'unknown');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'PENDING', 'a timer alone ended a payment');
});

test('verify: "pending" past the window -> ABANDONED (Paystack answered: not paid)', async () => {
  const p = await pending();
  await agePayment(t, p.id, 6);
  answer(p.reference, 'pending');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'ABANDONED');
});

test('sweep: checks every PENDING payment older than the 20 s fallback, and nothing younger or settled', async () => {
  const young = await pending();
  await clearPending(t, t.users.booth.id);
  await t.prisma.payment.update({ where: { id: young.id }, data: { status: 'PENDING' } });
  // Only one PENDING per operator: the old one belongs to another entry operator.
  const other = await addBoothOperator(t, `sweep.${Date.now()}`);
  const oldRes = await startCard(t, other.id, { ticketId: (await makeTicket(t)).id });
  const old = await t.prisma.payment.findUniqueOrThrow({ where: { id: oldRes.body.id } });
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '30 seconds' WHERE id = $1::uuid`, old.id);
  answer(old.reference, 'success', successData({ reference: old.reference, amountKobo: old.amountKobo }));

  // Settled = SUCCESS or DUPLICATE. Since T8 (Sprint 4b fix) card payments that
  // ENDED (ABANDONED, FAILED) within LATE_CHECK_MINUTES are checked too: late-check.lifecycle.test.ts.
  const settledBefore = await t.prisma.payment.findMany({ where: { siteId: t.siteId, status: { in: ['SUCCESS', 'DUPLICATE'] } }, select: { reference: true } });
  await jobs.sweep();

  assert.ok(t.paystack.verifyCalls.includes(old.reference), 'the old payment was not checked');
  assert.ok(!t.paystack.verifyCalls.includes(young.reference), 'a payment younger than the fallback was checked');
  for (const { reference } of settledBefore) {
    assert.ok(!t.paystack.verifyCalls.includes(reference), `a settled payment was checked: ${reference}`);
  }
  assert.equal((await status(old.id)).status, 'SUCCESS');
  await clearPending(t, other.id);
});

test('the sweep never reprocesses a DUPLICATE (or any settled payment): it checks PENDING, and ended card payments within the T8 window', async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, t.users.booth.id, { ticketId: tk.id });
  const p = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  await t.prisma.payment.update({ where: { id: p.id }, data: { status: 'ABANDONED' } });
  await payRaw(t, tk, 'CASH');
  // The card turns DUPLICATE, as the webhook would make it.
  await t.prisma.payment.update({ where: { id: p.id }, data: { status: 'DUPLICATE', paystackEvent: { reference: p.reference } } });
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '1 hour' WHERE id = $1::uuid`, p.id);
  answer(p.reference, 'success', successData({ reference: p.reference, amountKobo: p.amountKobo }));

  t.paystack.verifyCalls.length = 0;
  await jobs.sweep();
  await jobs.verifyOne(p.reference);
  assert.ok(!t.paystack.verifyCalls.includes(p.reference), 'a DUPLICATE was sent back to Paystack');
  assert.equal((await t.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status, 'DUPLICATE');
});
