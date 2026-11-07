import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { acceptedInit, postWebhook, successData } from '../test-support/paystack';
import { PaystackGateway } from '../paystack/paystack.gateway';
import { addBoothOperator, agePayment, newKey, startCard } from '../test-support/payments';
import { as, makeTicket, moveOperator } from '../test-support/tickets';

/**
 * POST /payments/:id/cancel (Sprint 4b, closes T7). A payment operator at a
 * booth cancels their own PENDING card payment, at least 60 s after it
 * started. Paystack is asked once: paid -> settled, "already paid"; not paid
 * or unknown transaction -> ABANDONED; no answer -> 503 unless force:true.
 * Paystack is the fake. See docs/api.md, "Booth".
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp({ captureLogs: true });
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await t.prisma.payment.updateMany({ where: { siteId: t.siteId, status: 'PENDING' }, data: { status: 'ABANDONED' } });
  t.paystack.onInitialize = acceptedInit;
  t.paystack.verifyAnswers.clear();
  t.paystack.verifyCalls.length = 0;
  t.logs.length = 0;
});

const booth = () => t.users.booth.id;

/** A PENDING card payment of the booth operator, already [ageSeconds] old. */
async function pendingCard(ageSeconds = 61, userId = booth()) {
  const tk = await makeTicket(t);
  const res = await startCard(t, userId, { ticketId: tk.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET created_at = now() - ($1 || ' seconds')::interval WHERE id = $2::uuid`,
    String(ageSeconds),
    res.body.id,
  );
  return { tk, payment: res.body as { id: string; reference: string; amountKobo: number } };
}

const cancel = (id: string, body: Record<string, unknown> = {}, userId = booth()) =>
  as(t, userId, 'POST', `/payments/${id}/cancel`, body);

const paymentRow = (id: string) => t.prisma.payment.findUniqueOrThrow({ where: { id } });
const ticketRow = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
const cancelAudits = (paymentId: string) =>
  t.prisma.auditLog.findMany({ where: { action: 'PAYMENT_CANCELLED', targetId: paymentId } });

// ---------------------------------------------------------------- who

test("another operator's payment, an unknown id, a malformed id and a cash payment are the same 404", async () => {
  const other = await addBoothOperator(t, `booth-x-${newKey().slice(0, 6)}`);
  const { payment } = await pendingCard(61, other.id);
  const theirs = await cancel(payment.id);
  assert.equal(theirs.status, 404);
  assert.equal((await paymentRow(payment.id)).status, 'PENDING', 'nothing changed');
  assert.equal(t.paystack.verifyCalls.length, 0, 'Paystack not asked');

  assert.equal((await cancel('00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await cancel('not-a-uuid')).status, 404);

  const tk = await makeTicket(t);
  const cash = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201);
  const res = await cancel(cash.body.id);
  assert.equal(res.status, 404);
  assert.equal((await paymentRow(cash.body.id)).status, 'SUCCESS');
});

test('only a payment operator may call it (403 for the other jobs)', async () => {
  const { payment } = await pendingCard();
  for (const user of [t.users.entry, t.users.exit, t.users.admin]) {
    const res = await cancel(payment.id, {}, user.id);
    assert.equal(res.status, 403, user.role);
  }
  assert.equal((await paymentRow(payment.id)).status, 'PENDING');
});

test('an operator no longer at an in-service booth is refused (400), nothing changed', async () => {
  const { payment } = await pendingCard();
  await moveOperator(t, booth(), t.entryGateId);
  try {
    const res = await cancel(payment.id);
    assert.equal(res.status, 400);
    assert.equal((await paymentRow(payment.id)).status, 'PENDING');
  } finally {
    await moveOperator(t, booth(), t.boothGateId);
  }
});

test('the body takes only force, a boolean', async () => {
  const { payment } = await pendingCard();
  assert.equal((await cancel(payment.id, { force: 'yes' })).status, 400);
  assert.equal((await cancel(payment.id, { reason: 'x' })).status, 400);
  assert.equal((await paymentRow(payment.id)).status, 'PENDING');
});

// ---------------------------------------------------------------- when

test('before 60 seconds: 409 with allowedAt (60 s after the start, database clock); Paystack not asked', async () => {
  const { payment } = await pendingCard(10);
  const res = await cancel(payment.id);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  const row = await paymentRow(payment.id);
  assert.equal(new Date(res.body.allowedAt).getTime(), row.createdAt.getTime() + 60_000);
  assert.match(res.body.message, /60 seconds/);
  assert.equal(row.status, 'PENDING');
  assert.equal(t.paystack.verifyCalls.length, 0);
  assert.equal((await cancelAudits(payment.id)).length, 0);
});

// ---------------------------------------------------------------- Paystack's answer

test('not paid (Paystack: pending): ABANDONED, ticket untouched, audited with the operator, not forced', async () => {
  const { tk, payment } = await pendingCard();
  const res = await cancel(payment.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'CANCELLED');
  assert.equal(res.body.forced, false);
  assert.equal(res.body.payment.status, 'ABANDONED');
  assert.deepEqual(t.paystack.verifyCalls, [payment.reference], 'Paystack asked once');
  assert.equal((await paymentRow(payment.id)).status, 'ABANDONED');
  const ticket = await ticketRow(tk.id);
  assert.equal(ticket.paymentStatus, 'UNPAID');
  assert.equal(ticket.paidPaymentId, null);
  const audits = await cancelAudits(payment.id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorId, booth());
  assert.deepEqual(audits[0].detail, { ticketNumber: tk.ticketNumber, forced: false });
  assert.ok(!JSON.stringify(res.body).includes(tk.token), 'no token in the answer');
});

test("not paid (Paystack: abandoned, or no such transaction): ABANDONED", async () => {
  for (const kind of ['abandoned', 'not_found'] as const) {
    const { payment } = await pendingCard();
    t.paystack.verifyAnswers.set(payment.reference, { kind, data: null, message: kind });
    const res = await cancel(payment.id);
    assert.equal(res.status, 200, kind);
    assert.equal(res.body.outcome, 'CANCELLED', kind);
    assert.equal((await paymentRow(payment.id)).status, 'ABANDONED', kind);
  }
});

test('paid (Paystack: success): settled as normal, "already paid", nothing cancelled or audited as cancelled', async () => {
  const { tk, payment } = await pendingCard();
  t.paystack.verifyAnswers.set(payment.reference, { kind: 'success', data: successData(payment), message: 'ok' });
  const res = await cancel(payment.id, { force: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'ALREADY_PAID');
  assert.equal(res.body.payment.status, 'SUCCESS');
  assert.equal((await ticketRow(tk.id)).paymentStatus, 'PAID');
  assert.equal((await ticketRow(tk.id)).paidPaymentId, payment.id);
  assert.equal((await cancelAudits(payment.id)).length, 0);
});

test('Paystack says failed: the payment is FAILED (nothing to cancel)', async () => {
  const { tk, payment } = await pendingCard();
  t.paystack.verifyAnswers.set(payment.reference, { kind: 'failed', data: { status: 'failed' }, message: 'declined' });
  const res = await cancel(payment.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'FAILED');
  assert.equal((await paymentRow(payment.id)).status, 'FAILED');
  assert.equal((await ticketRow(tk.id)).paymentStatus, 'UNPAID');
  assert.equal((await cancelAudits(payment.id)).length, 0);
});

test('no answer from Paystack: 503 "cannot be confirmed", still PENDING, not audited', async () => {
  const { payment } = await pendingCard();
  t.paystack.verifyAnswers.set(payment.reference, { kind: 'unknown', data: null, message: 'timeout' });
  const res = await cancel(payment.id);
  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.match(res.body.message, /cannot be confirmed/i);
  assert.equal(res.body.canForce, true);
  assert.equal((await paymentRow(payment.id)).status, 'PENDING');
  assert.equal((await cancelAudits(payment.id)).length, 0);
});

test('no answer + force:true: ABANDONED anyway, audited as forced', async () => {
  const { tk, payment } = await pendingCard();
  t.paystack.verifyAnswers.set(payment.reference, { kind: 'unknown', data: null, message: 'timeout' });
  const res = await cancel(payment.id, { force: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'CANCELLED');
  assert.equal(res.body.forced, true);
  assert.equal((await paymentRow(payment.id)).status, 'ABANDONED');
  assert.deepEqual((await cancelAudits(payment.id))[0].detail, { ticketNumber: tk.ticketNumber, forced: true });
});

test('force:true while Paystack answers counts for nothing: not forced, audited forced:false', async () => {
  const { payment } = await pendingCard();
  const res = await cancel(payment.id, { force: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.forced, false);
  assert.deepEqual((await cancelAudits(payment.id)).map((a) => (a.detail as { forced: boolean }).forced), [false]);
});

// ---------------------------------------------------------------- already ended

test('already ABANDONED or FAILED: a harmless 200, nothing changed, no new audit, Paystack not asked', async () => {
  for (const status of ['ABANDONED', 'FAILED'] as const) {
    const { payment } = await pendingCard();
    await t.prisma.payment.update({ where: { id: payment.id }, data: { status } });
    t.paystack.verifyCalls.length = 0;
    const res = await cancel(payment.id);
    assert.equal(res.status, 200, status);
    assert.equal(res.body.outcome, 'ALREADY_ENDED', status);
    assert.equal(res.body.payment.status, status);
    assert.equal(t.paystack.verifyCalls.length, 0, status);
    assert.equal((await cancelAudits(payment.id)).length, 0, status);
  }
});

test('a SUCCESS (or DUPLICATE) payment cannot be cancelled: 409', async () => {
  const { payment } = await pendingCard();
  const hook = await postWebhook(t.url, { event: 'charge.success', data: successData(payment) });
  assert.equal(hook.status, 200);
  assert.equal((await paymentRow(payment.id)).status, 'SUCCESS');
  const res = await cancel(payment.id);
  assert.equal(res.status, 409);
  assert.equal((await paymentRow(payment.id)).status, 'SUCCESS');

  const dup = await pendingCard();
  // A DUPLICATE carries Paystack's event and time (payment_duplicate_check).
  await t.prisma.payment.update({
    where: { id: dup.payment.id },
    data: { status: 'DUPLICATE', paystackEvent: successData(dup.payment), paystackPaidAt: new Date() },
  });
  assert.equal((await cancel(dup.payment.id)).status, 409);
});

// ---------------------------------------------------------------- after a cancel

test('after a cancel the slots are free at once: cash for the ticket, and a new card payment by the operator', async () => {
  const { tk, payment } = await pendingCard();
  // Before: cash refused because the card payment is PENDING (T7).
  const before = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(before.status, 409);
  assert.equal(before.body.pendingPaymentId, payment.id);

  assert.equal((await cancel(payment.id)).status, 200);

  const other = await makeTicket(t);
  const card = await startCard(t, booth(), { ticketId: other.id });
  assert.equal(card.status, 201, 'a new card payment by the same operator');
  await t.prisma.payment.update({ where: { id: card.body.id }, data: { status: 'ABANDONED' } });

  const cash = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201, 'cash for the same ticket');
  assert.equal((await ticketRow(tk.id)).paymentStatus, 'PAID');
});

test('the cancelled attempt\'s key replays the cancelled payment: "Try card again" must use a new key', async () => {
  const tk = await makeTicket(t);
  const key = newKey();
  const first = await startCard(t, booth(), { ticketId: tk.id, idempotencyKey: key });
  await agePayment(t, first.body.id, 2);
  assert.equal((await cancel(first.body.id)).status, 200);
  const sameKey = await startCard(t, booth(), { ticketId: tk.id, idempotencyKey: key });
  assert.equal(sameKey.status, 200);
  assert.equal(sameKey.body.id, first.body.id);
  assert.equal(sameKey.body.status, 'ABANDONED');
  const newAttempt = await startCard(t, booth(), { ticketId: tk.id });
  assert.equal(newAttempt.status, 201);
  assert.notEqual(newAttempt.body.id, first.body.id);
});

// ---------------------------------------------------------------- late success

test('a card success after a cancel, ticket still UNPAID: SUCCESS, ticket PAID, LATE_SUCCESS logged', async () => {
  const { tk, payment } = await pendingCard();
  assert.equal((await cancel(payment.id)).body.outcome, 'CANCELLED');
  const hook = await postWebhook(t.url, { event: 'charge.success', data: successData(payment) });
  assert.equal(hook.status, 200);
  assert.equal((await paymentRow(payment.id)).status, 'SUCCESS');
  const ticket = await ticketRow(tk.id);
  assert.equal(ticket.paymentStatus, 'PAID');
  assert.equal(ticket.paidPaymentId, payment.id);
  assert.ok(t.logs.some((l) => l.includes('LATE_SUCCESS') && l.includes(payment.reference)), t.logs.join('\n'));
});

test('a card success after a cancel, ticket already PAID by cash: DUPLICATE, the ticket keeps its cash payment', async () => {
  const { tk, payment } = await pendingCard();
  assert.equal((await cancel(payment.id)).status, 200);
  const cash = await as(t, booth(), 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() });
  assert.equal(cash.status, 201);
  const hook = await postWebhook(t.url, { event: 'charge.success', data: successData(payment) });
  assert.equal(hook.status, 200);
  assert.equal((await paymentRow(payment.id)).status, 'DUPLICATE');
  assert.equal((await ticketRow(tk.id)).paidPaymentId, cash.body.id);
  assert.ok(t.logs.some((l) => l.includes('DOUBLE_PAYMENT') && l.includes(payment.reference)));
});

// ---------------------------------------------------------------- races

test('cancel then webhook, and webhook then cancel: the payment ends SUCCESS and the ticket PAID either way', async () => {
  // Cancel first: Paystack (the fake) still says pending when asked.
  const a = await pendingCard();
  assert.equal((await cancel(a.payment.id)).body.outcome, 'CANCELLED');
  await postWebhook(t.url, { event: 'charge.success', data: successData(a.payment) });
  assert.equal((await paymentRow(a.payment.id)).status, 'SUCCESS');
  assert.equal((await ticketRow(a.tk.id)).paymentStatus, 'PAID');

  // Webhook first; the cancel's own Paystack check is stale ("pending"), but
  // under the lock it finds SUCCESS and cancels nothing.
  const b = await pendingCard();
  await postWebhook(t.url, { event: 'charge.success', data: successData(b.payment) });
  const res = await cancel(b.payment.id);
  assert.equal(res.status, 409, 'SUCCESS before the cancel arrives: 409');
  assert.equal((await paymentRow(b.payment.id)).status, 'SUCCESS');
  assert.equal((await ticketRow(b.tk.id)).paymentStatus, 'PAID');
  assert.equal((await cancelAudits(b.payment.id)).length, 0);
});

test('webhook lands between the cancel\'s Paystack check and its write: the cancel sees SUCCESS and cancels nothing', async () => {
  const { tk, payment } = await pendingCard();
  // The fake's verify answers "pending", then the webhook settles before the cancel writes.
  const gw = t.app.get(PaystackGateway);
  const original = gw.verify;
  gw.verify = async (reference: string) => {
    const answer = await original.call(gw, reference);
    await postWebhook(t.url, { event: 'charge.success', data: successData(payment) });
    return answer;
  };
  try {
    const res = await cancel(payment.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, 'ALREADY_PAID');
  } finally {
    gw.verify = original;
  }
  assert.equal((await paymentRow(payment.id)).status, 'SUCCESS');
  assert.equal((await ticketRow(tk.id)).paymentStatus, 'PAID');
  assert.equal((await cancelAudits(payment.id)).length, 0);
});

test('cancel and webhook at the same moment, 20 rounds: never a lost payment (always SUCCESS + PAID)', async () => {
  const seen = { cancelled: 0, alreadyPaid: 0, conflict: 0 };
  for (let round = 0; round < 20; round++) {
    const { tk, payment } = await pendingCard();
    const lag = (round % 4) * 5;
    const [res] = await Promise.all([
      cancel(payment.id),
      new Promise((r) => setTimeout(r, lag)).then(() =>
        postWebhook(t.url, { event: 'charge.success', data: successData(payment) }),
      ),
    ]);
    if (res.status === 200 && res.body.outcome === 'CANCELLED') seen.cancelled++;
    else if (res.status === 200 && res.body.outcome === 'ALREADY_PAID') seen.alreadyPaid++;
    else if (res.status === 409) seen.conflict++;
    else assert.fail(`round ${round}: ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal((await paymentRow(payment.id)).status, 'SUCCESS', `round ${round}`);
    const ticket = await ticketRow(tk.id);
    assert.equal(ticket.paymentStatus, 'PAID', `round ${round}`);
    assert.equal(ticket.paidPaymentId, payment.id, `round ${round}`);
  }
  console.log(`race outcomes over 20 rounds: ${JSON.stringify(seen)}`);
});

// ---------------------------------------------------------------- the route table

test('malformed JSON is 400 and echoes nothing of the body', async () => {
  const { payment } = await pendingCard();
  const res = await call(t, 'POST', `/payments/${payment.id}/cancel`, {
    token: await t.accessToken(booth()),
    rawBody: '{"force": trueish-secret',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { statusCode: 400, message: 'The request body is not valid JSON', error: 'Bad Request' });
  assert.equal((await paymentRow(payment.id)).status, 'PENDING');
});
