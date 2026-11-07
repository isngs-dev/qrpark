import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { bootTestApp, type TestApp } from '../test-support/app';
import { postWebhook, successData } from '../test-support/paystack';
import { newKey } from '../test-support/payments';
import { as, makeTicket, payRaw, type MadeTicket } from '../test-support/tickets';

/**
 * POST /paystack/webhook: signature first, idempotent settle, and the ticket
 * PAID in the same transaction (ticket row locked first). Booted with
 * captureLogs so the last test can prove nothing secret reached a log line.
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp({ captureLogs: true });
});
after(() => t?.close());
beforeEach(async () => {
  if (t) await t.prisma.payment.updateMany({ where: { siteId: t.siteId, status: 'PENDING' }, data: { status: 'ABANDONED' } });
});

async function pendingCard(tk?: MadeTicket) {
  const ticket = tk ?? (await makeTicket(t));
  const res = await as(t, t.users.booth.id, 'POST', '/payments/card', { ticketId: ticket.id, idempotencyKey: newKey() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ticket, payment: res.body as { id: string; reference: string; authorizationUrl: string; accessCode: string } };
}

const success = (reference: string, amountKobo: number, overrides = {}) => ({
  event: 'charge.success',
  data: successData({ reference, amountKobo }, overrides),
});

const rows = async (paymentId: string, ticketId: string) => ({
  payment: await t.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
  ticket: await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
});

// ---------------------------------------------------------------- signature

test('a bad, missing or altered signature is 401 and changes nothing', async () => {
  const { ticket, payment } = await pendingCard();
  const body = success(payment.reference, ticket.feeKobo);
  assert.equal((await postWebhook(t.url, body, { signature: 'a'.repeat(128) })).status, 401);
  assert.equal((await postWebhook(t.url, body, { signature: null })).status, 401);
  const signedFor = JSON.stringify(success(payment.reference, 1));
  const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(signedFor).digest('hex');
  assert.equal((await postWebhook(t.url, body, { signature })).status, 401);
  const after = await rows(payment.id, ticket.id);
  assert.equal(after.payment.status, 'PENDING');
  assert.equal(after.ticket.paymentStatus, 'UNPAID');
});

test('a validly signed webhook for an unknown reference is 200 and changes nothing', async () => {
  const before = await t.prisma.payment.count({ where: { siteId: t.siteId, status: 'SUCCESS' } });
  const res = await postWebhook(t.url, success('QRP_000000000000000000000000', 50_000));
  assert.equal(res.status, 200);
  assert.equal(await t.prisma.payment.count({ where: { siteId: t.siteId, status: 'SUCCESS' } }), before);
});

test('a validly signed event we do not act on is 200 and changes nothing', async () => {
  const { ticket, payment } = await pendingCard();
  assert.equal((await postWebhook(t.url, { event: 'transfer.success', data: { reference: payment.reference } })).status, 200);
  assert.equal((await rows(payment.id, ticket.id)).payment.status, 'PENDING');
});

// ------------------------------------------------------------ settle

test('charge.success: payment SUCCESS and the ticket PAID through it, in one step; backend and Paystack times kept', async () => {
  const { ticket, payment } = await pendingCard();
  const before = Date.now();
  assert.equal((await postWebhook(t.url, success(payment.reference, ticket.feeKobo))).status, 200);
  const after = await rows(payment.id, ticket.id);
  assert.equal(after.payment.status, 'SUCCESS');
  assert.ok(after.payment.paidAt && after.payment.paidAt.getTime() >= before - 1000);
  assert.equal(after.payment.paystackPaidAt?.toISOString(), '2026-11-06T09:58:01.000Z');
  assert.equal(after.ticket.paymentStatus, 'PAID');
  assert.equal(after.ticket.paidPaymentId, payment.id);
  assert.equal(after.ticket.validationStatus, 'NOT_VALIDATED');
  const stored = after.payment.paystackEvent as { authorization?: Record<string, unknown> };
  assert.equal(stored.authorization?.authorization_code, undefined, 'the reusable card authorization was stored');
});

test('replay: the same webhook again, and five at once, change nothing more', async () => {
  const { ticket, payment } = await pendingCard();
  await postWebhook(t.url, success(payment.reference, ticket.feeKobo));
  const first = await rows(payment.id, ticket.id);
  const results = await Promise.all(Array.from({ length: 5 }, () => postWebhook(t.url, success(payment.reference, ticket.feeKobo))));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200]);
  const again = await rows(payment.id, ticket.id);
  assert.equal(again.ticket.paidAt?.getTime(), first.ticket.paidAt?.getTime());
  assert.equal(await t.prisma.payment.count({ where: { ticketId: ticket.id, status: 'SUCCESS' } }), 1);
});

test('five simultaneous first deliveries: one SUCCESS, the ticket PAID once', async () => {
  const { ticket, payment } = await pendingCard();
  const results = await Promise.all(Array.from({ length: 5 }, () => postWebhook(t.url, success(payment.reference, ticket.feeKobo))));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal((await rows(payment.id, ticket.id)).ticket.paymentStatus, 'PAID');
});

// ---------------------------------------------- no PAID unless SUCCESS

test('charge.failed: FAILED, the ticket stays UNPAID', async () => {
  const { ticket, payment } = await pendingCard();
  await postWebhook(t.url, { event: 'charge.failed', data: { reference: payment.reference, status: 'failed' } });
  const after = await rows(payment.id, ticket.id);
  assert.equal(after.payment.status, 'FAILED');
  assert.equal(after.ticket.paymentStatus, 'UNPAID');
});

test("wrong amount or currency against the ticket's fee: no SUCCESS, the ticket stays UNPAID", async () => {
  const { ticket, payment } = await pendingCard();
  for (const overrides of [{ amount: ticket.feeKobo - 1 }, { amount: ticket.feeKobo / 100 }, { currency: 'USD' }, { amount: String(ticket.feeKobo) }]) {
    assert.equal((await postWebhook(t.url, success(payment.reference, ticket.feeKobo, overrides))).status, 200);
    const after = await rows(payment.id, ticket.id);
    assert.equal(after.payment.status, 'PENDING', JSON.stringify(overrides));
    assert.equal(after.ticket.paymentStatus, 'UNPAID');
  }
});

test('late SUCCESS after ABANDONED or FAILED: accepted; the ticket PAID; a LATE_SUCCESS warning', async () => {
  for (const status of ['ABANDONED', 'FAILED'] as const) {
    const { ticket, payment } = await pendingCard();
    await t.prisma.payment.update({ where: { id: payment.id }, data: { status } });
    await postWebhook(t.url, success(payment.reference, ticket.feeKobo));
    const after = await rows(payment.id, ticket.id);
    assert.equal(after.payment.status, 'SUCCESS', status);
    assert.equal(after.ticket.paymentStatus, 'PAID');
    assert.ok(t.logs.some((l) => l.startsWith('WARN') && l.includes('LATE_SUCCESS') && l.includes(payment.reference)));
  }
});

test('Q1: card SUCCESS for a ticket already PAID (cash) -> DUPLICATE, ticket untouched, ERROR DOUBLE_PAYMENT', async () => {
  const { ticket, payment } = await pendingCard();
  await t.prisma.payment.update({ where: { id: payment.id }, data: { status: 'ABANDONED' } });
  const cashId = await payRaw(t, ticket, 'CASH');
  const before = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal((await postWebhook(t.url, success(payment.reference, ticket.feeKobo))).status, 200);
  const after = await rows(payment.id, ticket.id);
  assert.equal(after.payment.status, 'DUPLICATE');
  assert.equal(after.payment.paystackPaidAt?.toISOString(), '2026-11-06T09:58:01.000Z', "Paystack's time not kept");
  assert.ok(after.payment.paystackEvent, "Paystack's payload not kept");
  assert.equal(after.payment.paidAt, null, 'a DUPLICATE is not revenue');
  assert.deepEqual(after.ticket, before, 'the ticket changed');
  assert.equal(after.ticket.paidPaymentId, cashId);
  assert.ok(t.logs.some((l) => l.startsWith('ERROR') && l.includes('DOUBLE_PAYMENT') && l.includes(payment.reference)));

  // A replay of it changes nothing either.
  await postWebhook(t.url, success(payment.reference, ticket.feeKobo));
  assert.equal((await rows(payment.id, ticket.id)).payment.status, 'DUPLICATE');
});

test('Q2: card SUCCESS after the ticket expired -> SUCCESS, ticket PAID, still EXPIRED at exit; warning', async () => {
  // A card payment started yesterday for yesterday's ticket, confirmed today.
  const ticket = await makeTicket(t, { issuedAt: '2026-11-01T10:00:00Z' });
  const ref = `QRP_${randomBytes(12).toString('hex')}`;
  const p = await t.prisma.payment.create({
    data: {
      siteId: t.siteId, ticketId: ticket.id, amountKobo: ticket.feeKobo, method: 'CARD', reference: ref,
      idempotencyKey: newKey(), operatorId: t.users.booth.id, gateId: t.boothGateId, deviceRef: 'd', status: 'ABANDONED',
    },
  });
  assert.equal((await postWebhook(t.url, success(ref, ticket.feeKobo))).status, 200);
  const after = await rows(p.id, ticket.id);
  assert.equal(after.payment.status, 'SUCCESS');
  assert.equal(after.ticket.paymentStatus, 'PAID');
  assert.ok(after.ticket.validUntil.getTime() < Date.now(), 'the ticket is not expired');
  assert.ok(t.logs.some((l) => l.startsWith('WARN') && l.includes('LATE_SUCCESS_EXPIRED') && l.includes(ref)));

  const exit = await as(t, t.users.exit.id, 'POST', '/tickets/validate', { token: ticket.token });
  assert.equal(exit.body.result, 'EXPIRED');
});

test('a SUCCESS payment never moves back to FAILED on a late charge.failed', async () => {
  const { ticket, payment } = await pendingCard();
  await postWebhook(t.url, success(payment.reference, ticket.feeKobo));
  await postWebhook(t.url, { event: 'charge.failed', data: { reference: payment.reference, status: 'failed' } });
  assert.equal((await rows(payment.id, ticket.id)).payment.status, 'SUCCESS');
});

// -------------------------------------------------------------- logs

test('no log line holds a token, card data, the checkout link, the access code or the payload', async () => {
  const { ticket, payment } = await pendingCard();
  await postWebhook(t.url, success(payment.reference, ticket.feeKobo));
  const all = t.logs.join('\n');
  assert.ok(t.logs.length > 0);
  for (const secret of [ticket.token, payment.authorizationUrl, payment.accessCode, '4081', '408408', 'AUTH_secret123', 'walkin@gsds.com.ng', '"amount"']) {
    assert.ok(!all.includes(secret), `a log line contains ${secret}`);
  }
});
