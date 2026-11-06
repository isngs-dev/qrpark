import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { successData } from '../test-support/paystack';
import { addCategory, agePayment, clearPending, startPayment } from '../test-support/payments';
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
  await addCategory(t, 'CAR', 50_000);
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await clearPending(t, t.users.entry.id);
  t.paystack.verifyAnswers.clear();
  t.paystack.verifyCalls.length = 0;
});

async function pending(opts: { checkout?: boolean } = {}) {
  if (opts.checkout === false) {
    t.paystack.onInitialize = () => ({ outcome: 'unknown', authorizationUrl: null, accessCode: null, message: 'timeout' });
  }
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  t.paystack.onInitialize = (r) => ({ outcome: 'accepted', authorizationUrl: `https://checkout.paystack.test/${r.reference}`, accessCode: 'ac', message: 'ok' });
  const id = res.body.id ?? res.body.paymentId;
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id } });
  return row;
}

const answer = (reference: string, kind: 'success' | 'failed' | 'abandoned' | 'pending' | 'not_found' | 'unknown', data: Record<string, unknown> | null = null) =>
  t.paystack.verifyAnswers.set(reference, { kind, data: data ?? (kind === 'not_found' || kind === 'unknown' ? null : { reference, status: kind }), message: kind });

const status = async (id: string) => (await t.prisma.payment.findUniqueOrThrow({ where: { id }, include: { ticket: true } }));

test('verify: success -> SUCCESS and a ticket', async () => {
  const p = await pending();
  answer(p.reference, 'success', successData({ reference: p.reference, amountKobo: p.amountKobo }));
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'SUCCESS');
  assert.ok(after.ticket);
});

test('verify: success with the wrong amount -> unchanged, no ticket', async () => {
  const p = await pending();
  answer(p.reference, 'success', successData({ reference: p.reference, amountKobo: 1 }));
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'PENDING');
  assert.equal(after.ticket, null);
});

test('verify: failed -> FAILED, no ticket', async () => {
  const p = await pending();
  answer(p.reference, 'failed');
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'FAILED');
  assert.equal(after.ticket, null);
});

test('verify: "abandoned" inside the window stays PENDING (the customer may still be paying)', async () => {
  const p = await pending();
  answer(p.reference, 'abandoned');
  await jobs.verifyOne(p.reference);
  assert.equal((await status(p.id)).status, 'PENDING');
});

test('verify: "abandoned" past the window -> ABANDONED, no ticket', async () => {
  const p = await pending();
  await agePayment(t, p.id, 6);
  answer(p.reference, 'abandoned');
  await jobs.verifyOne(p.reference);
  const after = await status(p.id);
  assert.equal(after.status, 'ABANDONED');
  assert.equal(after.ticket, null);
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
  await clearPending(t, t.users.entry.id);
  await t.prisma.payment.update({ where: { id: young.id }, data: { status: 'PENDING' } });
  // Only one PENDING per operator: the old one belongs to another entry operator.
  const { addEntryOperator } = await import('../test-support/payments');
  const other = await addEntryOperator(t, `sweep.${Date.now()}`);
  const oldRes = await startPayment(t, other.id, { categoryCode: 'CAR' });
  const old = await t.prisma.payment.findUniqueOrThrow({ where: { id: oldRes.body.id } });
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '30 seconds' WHERE id = $1::uuid`, old.id);
  answer(old.reference, 'success', successData({ reference: old.reference, amountKobo: old.amountKobo }));

  const settledBefore = await t.prisma.payment.findMany({ where: { siteId: t.siteId, status: { not: 'PENDING' } }, select: { reference: true } });
  await jobs.sweep();

  assert.ok(t.paystack.verifyCalls.includes(old.reference), 'the old payment was not checked');
  assert.ok(!t.paystack.verifyCalls.includes(young.reference), 'a payment younger than the fallback was checked');
  for (const { reference } of settledBefore) {
    assert.ok(!t.paystack.verifyCalls.includes(reference), `a settled payment was checked: ${reference}`);
  }
  assert.equal((await status(old.id)).status, 'SUCCESS');
  await clearPending(t, other.id);
});
