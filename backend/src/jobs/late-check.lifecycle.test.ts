import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { acceptedInit, successData } from '../test-support/paystack';
import { clearPending, newKey, startCard } from '../test-support/payments';
import { as, makeTicket } from '../test-support/tickets';
import { LATE_CHECK_MINUTES, ReconciliationService } from './reconciliation.service';

/**
 * T8 (decided, Sprint 4b fix): the delayed checks and the sweep also verify
 * CARD payments that are ABANDONED or FAILED, for LATE_CHECK_MINUTES after
 * they ended, at most one Paystack call per payment per sweep, and also when
 * the ticket was meanwhile paid by cash. Only Paystack's SUCCESS changes
 * anything, through the unchanged settlement: LATE_SUCCESS (ticket PAID), or
 * DUPLICATE when the ticket was already paid. Paystack is the fake.
 */

let t: TestApp;
let jobs: ReconciliationService;
before(async () => {
  t = await bootTestApp({ captureLogs: true });
  jobs = t.app.get(ReconciliationService);
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  // Older test rows must not take part: every earlier card payment is pushed out of the late window.
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET updated_at = now() - interval '2 hours' WHERE site_id = $1::uuid AND status IN ('ABANDONED','FAILED')`,
    t.siteId,
  );
  await clearPending(t, t.users.booth.id);
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET updated_at = now() - interval '2 hours' WHERE site_id = $1::uuid AND status IN ('ABANDONED','FAILED')`,
    t.siteId,
  );
  t.paystack.onInitialize = acceptedInit;
  t.paystack.verifyAnswers.clear();
  t.paystack.verifyCalls.length = 0;
  t.logs.length = 0;
});

const booth = () => t.users.booth.id;

/** A card payment cancelled at the booth (Paystack said "pending" then), just now. */
async function cancelled() {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '61 seconds' WHERE id = $1::uuid`, res.body.id);
  const c = await as(t, booth(), 'POST', `/payments/${res.body.id}/cancel`, {});
  assert.equal(c.body.outcome, 'CANCELLED', JSON.stringify(c.body));
  t.paystack.verifyCalls.length = 0;
  const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  return { tk, payment };
}

const paid = (p: { reference: string; amountKobo: number }) =>
  t.paystack.verifyAnswers.set(p.reference, { kind: 'success', data: successData(p), message: 'ok' });

const row = (id: string) => t.prisma.payment.findUniqueOrThrow({ where: { id } });
const ticket = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
const calls = (reference: string) => t.paystack.verifyCalls.filter((r) => r === reference).length;

async function endedMinutesAgo(id: string, minutes: number) {
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET updated_at = now() - ($1 || ' minutes')::interval WHERE id = $2::uuid`, String(minutes), id);
}

// ---------------------------------------------------------------- the sweep

test('the sweep settles a cancelled payment later paid on Paystack: SUCCESS, ticket PAID, LATE_SUCCESS', async () => {
  const { tk, payment } = await cancelled();
  paid(payment);
  await jobs.sweep();
  assert.equal((await row(payment.id)).status, 'SUCCESS');
  assert.equal((await ticket(tk.id)).paymentStatus, 'PAID');
  assert.equal((await ticket(tk.id)).paidPaymentId, payment.id);
  assert.ok(t.logs.some((l) => l.includes('LATE_SUCCESS') && l.includes(payment.reference)), t.logs.join('\n'));
});

test('... and after cash was taken for the ticket: the late card payment becomes DUPLICATE, the ticket keeps its cash', async () => {
  const { tk, payment } = await cancelled();
  const cash = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201);
  paid(payment);
  await jobs.sweep();
  assert.equal((await row(payment.id)).status, 'DUPLICATE');
  assert.equal((await ticket(tk.id)).paidPaymentId, cash.body.id);
  assert.ok(t.logs.some((l) => l.includes('DOUBLE_PAYMENT') && l.includes(payment.reference)));
});

test('a FAILED card payment later paid on Paystack is settled too', async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id });
  await t.prisma.payment.update({ where: { id: res.body.id }, data: { status: 'FAILED' } });
  const payment = await row(res.body.id);
  paid(payment);
  await jobs.sweep();
  assert.equal((await row(payment.id)).status, 'SUCCESS');
  assert.equal((await ticket(tk.id)).paymentStatus, 'PAID');
});

test(`not verified once it ended more than ${LATE_CHECK_MINUTES} minutes ago: no Paystack call, nothing changes`, async () => {
  const { tk, payment } = await cancelled();
  await endedMinutesAgo(payment.id, LATE_CHECK_MINUTES + 1);
  paid(payment);
  await jobs.sweep();
  await jobs.verifyOne(payment.reference);
  assert.equal(calls(payment.reference), 0);
  assert.equal((await row(payment.id)).status, 'ABANDONED');
  assert.equal((await ticket(tk.id)).paymentStatus, 'UNPAID');
});

test(`still verified just inside the ${LATE_CHECK_MINUTES} minutes`, async () => {
  const { payment } = await cancelled();
  await endedMinutesAgo(payment.id, LATE_CHECK_MINUTES - 1);
  paid(payment);
  await jobs.sweep();
  assert.equal((await row(payment.id)).status, 'SUCCESS');
});

test('Paystack unreachable, or anything but success, changes nothing on an ended payment', async () => {
  for (const kind of ['unknown', 'pending', 'abandoned', 'failed', 'not_found'] as const) {
    const { tk, payment } = await cancelled();
    t.paystack.verifyAnswers.set(payment.reference, { kind, data: kind === 'failed' ? { status: 'failed' } : null, message: kind });
    await jobs.sweep();
    await jobs.verifyOne(payment.reference);
    const after = await row(payment.id);
    assert.equal(after.status, 'ABANDONED', kind);
    assert.equal((await ticket(tk.id)).paymentStatus, 'UNPAID', kind);
    assert.ok(calls(payment.reference) >= 1, `${kind}: Paystack was asked`);
  }
});

test('a FAILED payment stays FAILED on any answer but success', async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id });
  await t.prisma.payment.update({ where: { id: res.body.id }, data: { status: 'FAILED' } });
  for (const kind of ['unknown', 'abandoned', 'pending', 'not_found'] as const) {
    t.paystack.verifyAnswers.set(res.body.reference, { kind, data: null, message: kind });
    await jobs.sweep();
    assert.equal((await row(res.body.id)).status, 'FAILED', kind);
  }
});

test('at most one Paystack call per payment per sweep', async () => {
  // An ended payment: one call.
  const { payment } = await cancelled();
  await jobs.sweep();
  assert.equal(calls(payment.reference), 1);

  // A PENDING one past its window that the same sweep abandons is not asked again as "ended".
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id });
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '2 hours' WHERE id = $1::uuid`, res.body.id);
  t.paystack.verifyAnswers.set(res.body.reference, { kind: 'abandoned', data: null, message: 'abandoned' });
  t.paystack.verifyCalls.length = 0;
  await jobs.sweep();
  assert.equal((await row(res.body.id)).status, 'ABANDONED', 'the sweep abandoned it');
  assert.equal(calls(res.body.reference), 1, 'asked once in that sweep');
});

test('cash payments and SUCCESS / DUPLICATE payments are never verified', async () => {
  const tk = await makeTicket(t);
  const cash = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  const done = await cancelled();
  paid(done.payment);
  await jobs.sweep(); // settles it: SUCCESS
  t.paystack.verifyCalls.length = 0;
  await jobs.sweep();
  await jobs.verifyOne(done.payment.reference);
  assert.equal(calls(cash.body.reference), 0, 'cash');
  assert.equal(calls(done.payment.reference), 0, 'SUCCESS');
});

// ---------------------------------------------------------------- the delayed checks

test('a delayed check that fires after a cancel verifies the ended payment and settles a late success', async () => {
  const { tk, payment } = await cancelled();
  paid(payment);
  await jobs.verifyOne(payment.reference);
  assert.equal((await row(payment.id)).status, 'SUCCESS');
  assert.equal((await ticket(tk.id)).paymentStatus, 'PAID');
});

test('the delayed check still handles PENDING exactly as before', async () => {
  const tk = await makeTicket(t);
  const res = await startCard(t, booth(), { ticketId: tk.id });
  const payment = await row(res.body.id);
  await jobs.verifyOne(payment.reference);
  assert.equal((await row(payment.id)).status, 'PENDING', 'pending inside the window stays PENDING');
  paid(payment);
  await jobs.verifyOne(payment.reference);
  assert.equal((await row(payment.id)).status, 'SUCCESS');
  assert.ok(!t.logs.some((l) => l.includes('LATE_SUCCESS') && l.includes(payment.reference)), 'an on-time success is not late');
});
