import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { postWebhook, successData } from '../test-support/paystack';
import { addCategory, clearPending, getPayment, startPayment } from '../test-support/payments';
import { TICKET_NUMBER_PATTERN, TOKEN_PATTERN } from '../tickets/ticket-codes';
import { TicketIssuer } from '../tickets/ticket-issuer';

/**
 * POST /paystack/webhook: signature first, idempotent settle, the ticket in
 * the same transaction as SUCCESS. Booted with captureLogs so the last test
 * can prove nothing secret reached a log line.
 */

let t: TestApp;
before(async () => {
  t = await bootTestApp({ captureLogs: true });
  await addCategory(t, 'CAR', 50_000);
});
after(() => t?.close());
beforeEach(async () => {
  if (t) await clearPending(t, t.users.entry.id);
});

async function pending() {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string; reference: string; amountKobo: number; authorizationUrl: string; accessCode: string };
}

const success = (p: { reference: string; amountKobo: number }, overrides = {}) => ({
  event: 'charge.success',
  data: successData(p, overrides),
});

async function state(paymentId: string) {
  const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { ticket: true } });
  return payment;
}

// ---------------------------------------------------------------- signature

test('a bad signature is 401 and changes nothing', async () => {
  const p = await pending();
  const res = await postWebhook(t.url, success(p), { signature: 'a'.repeat(128) });
  assert.equal(res.status, 401);
  const after = await state(p.id);
  assert.equal(after.status, 'PENDING');
  assert.equal(after.ticket, null);
});

test('a missing signature is 401 and changes nothing', async () => {
  const p = await pending();
  const res = await postWebhook(t.url, success(p), { signature: null });
  assert.equal(res.status, 401);
  assert.equal((await state(p.id)).status, 'PENDING');
});

test('a body changed after signing is 401 and changes nothing', async () => {
  const p = await pending();
  const signedFor = JSON.stringify(success(p, { amount: 1 }));
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(signedFor).digest('hex');
  const res = await postWebhook(t.url, success(p), { signature });
  assert.equal(res.status, 401);
  assert.equal((await state(p.id)).status, 'PENDING');
});

test('a validly signed webhook for an unknown reference is 200 and changes nothing', async () => {
  // Scoped to this site: other test files issue tickets at the same time.
  const before = await t.prisma.ticket.count({ where: { siteId: t.siteId } });
  const paymentsBefore = await t.prisma.payment.count({ where: { siteId: t.siteId, status: 'SUCCESS' } });
  const res = await postWebhook(t.url, success({ reference: 'QRP_000000000000000000000000', amountKobo: 50_000 }));
  assert.equal(res.status, 200);
  assert.equal(await t.prisma.ticket.count({ where: { siteId: t.siteId } }), before);
  assert.equal(await t.prisma.payment.count({ where: { siteId: t.siteId, status: 'SUCCESS' } }), paymentsBefore);
});

test('a validly signed event we do not act on is 200 and changes nothing', async () => {
  const p = await pending();
  const res = await postWebhook(t.url, { event: 'transfer.success', data: { reference: p.reference } });
  assert.equal(res.status, 200);
  assert.equal((await state(p.id)).status, 'PENDING');
});

// ------------------------------------------------------- settle and issue

test('charge.success: SUCCESS, and the ticket in the same step: opaque token, number, validity from backend time', async () => {
  const p = await pending();
  const before = Date.now();
  const res = await postWebhook(t.url, success(p));
  assert.equal(res.status, 200);

  const after = await state(p.id);
  assert.equal(after.status, 'SUCCESS');
  assert.ok(after.paidAt && after.paidAt.getTime() >= before - 1000, 'paid_at is not backend time');
  assert.equal(after.paystackPaidAt?.toISOString(), '2026-11-06T09:58:01.000Z', "Paystack's own time not kept");

  const ticket = after.ticket!;
  assert.ok(ticket, 'no ticket after SUCCESS');
  assert.match(ticket.token, TOKEN_PATTERN);
  assert.ok(!ticket.token.includes(p.reference) && !ticket.token.includes(after.id), 'token is derived from ids');
  assert.match(ticket.ticketNumber, TICKET_NUMBER_PATTERN);
  assert.equal(ticket.paidAt.getTime(), after.paidAt!.getTime());
  assert.equal(ticket.validityHours, 12);
  assert.equal(ticket.validUntil.getTime(), after.paidAt!.getTime() + 12 * 3600_000);
  assert.equal(ticket.amountKobo, 50_000);
  assert.equal(ticket.categoryName, 'Car');
  assert.equal(ticket.paymentReference, p.reference);
  assert.equal(ticket.operatorId, t.users.entry.id);
  assert.equal(ticket.gateId, t.entryGateId);
  assert.equal(ticket.status, 'ACTIVE');

  const poll = await getPayment(t, t.users.entry.id, p.id);
  assert.equal(poll.body.ticket.token, ticket.token);
  assert.equal(poll.body.ticket.ticketNumber, ticket.ticketNumber);
  assert.deepEqual(poll.body.ticket.header, { displayName: 'Test Market', receiptOrgName: null, receiptContactLine: null });
});

test('replay: the same webhook again is 200, and there is still exactly one ticket, unchanged', async () => {
  const p = await pending();
  await postWebhook(t.url, success(p));
  const first = (await state(p.id)).ticket!;
  const again = await postWebhook(t.url, success(p));
  assert.equal(again.status, 200);
  const tickets = await t.prisma.ticket.findMany({ where: { paymentId: p.id } });
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].token, first.token);
  assert.equal(tickets[0].ticketNumber, first.ticketNumber);
});

test('replay at the same moment: five identical webhooks at once make one ticket', async () => {
  const p = await pending();
  const results = await Promise.all(Array.from({ length: 5 }, () => postWebhook(t.url, success(p))));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(await t.prisma.ticket.count({ where: { paymentId: p.id } }), 1);
});

test('validity hours are read when the ticket is issued, not when the payment started', async () => {
  const p = await pending();
  await t.prisma.siteSetting.update({ where: { siteId: t.siteId }, data: { validityHours: 2 } });
  try {
    await postWebhook(t.url, success(p));
    const ticket = (await state(p.id)).ticket!;
    assert.equal(ticket.validityHours, 2);
    assert.equal(ticket.validUntil.getTime() - ticket.paidAt.getTime(), 2 * 3600_000);
  } finally {
    await t.prisma.siteSetting.update({ where: { siteId: t.siteId }, data: { validityHours: 12 } });
  }
});

// ------------------------------------------- no ticket unless SUCCESS

test('charge.failed: FAILED, no ticket', async () => {
  const p = await pending();
  const res = await postWebhook(t.url, { event: 'charge.failed', data: { reference: p.reference, status: 'failed' } });
  assert.equal(res.status, 200);
  const after = await state(p.id);
  assert.equal(after.status, 'FAILED');
  assert.equal(after.ticket, null);
});

test('wrong amount: no SUCCESS and no ticket', async () => {
  const p = await pending();
  for (const overrides of [{ amount: 49_999 }, { amount: 500 }, { currency: 'USD' }, { amount: '50000' }]) {
    const res = await postWebhook(t.url, success(p, overrides));
    assert.equal(res.status, 200);
    const after = await state(p.id);
    assert.equal(after.status, 'PENDING', `settled on ${JSON.stringify(overrides)}`);
    assert.equal(after.ticket, null);
  }
});

test('late SUCCESS after FAILED: Paystack is the authority; SUCCESS and a ticket', async () => {
  const p = await pending();
  await postWebhook(t.url, { event: 'charge.failed', data: { reference: p.reference, status: 'failed' } });
  await postWebhook(t.url, success(p));
  const after = await state(p.id);
  assert.equal(after.status, 'SUCCESS');
  assert.ok(after.ticket);
});

test('late SUCCESS after ABANDONED: SUCCESS, a ticket, and a warning logged', async () => {
  const p = await pending();
  await t.prisma.payment.update({ where: { id: p.id }, data: { status: 'ABANDONED' } });
  await postWebhook(t.url, success(p));
  const after = await state(p.id);
  assert.equal(after.status, 'SUCCESS');
  assert.ok(after.ticket);
  assert.ok(
    t.logs.some((l) => l.startsWith('WARN') && l.includes('LATE_SUCCESS') && l.includes(p.reference)),
    'no late-success warning',
  );
});

test('a SUCCESS payment never moves back to FAILED on a late charge.failed', async () => {
  const p = await pending();
  await postWebhook(t.url, success(p));
  await postWebhook(t.url, { event: 'charge.failed', data: { reference: p.reference, status: 'failed' } });
  assert.equal((await state(p.id)).status, 'SUCCESS');
});

// --------------------------------------------- ticket number collision

test('a ticket-number collision is retried inside the transaction; the payment still settles', async () => {
  const first = await pending();
  await postWebhook(t.url, success(first));
  const taken = (await state(first.id)).ticket!.ticketNumber;

  const issuer = t.app.get(TicketIssuer);
  const original = issuer.nextNumber;
  const sequence = [taken, taken, 'ZZZZ-2345'];
  issuer.nextNumber = () => sequence.shift() ?? original();
  try {
    const second = await pending();
    const res = await postWebhook(t.url, success(second));
    assert.equal(res.status, 200);
    const after = await state(second.id);
    assert.equal(after.status, 'SUCCESS', 'the collision aborted the settlement');
    assert.equal(after.ticket?.ticketNumber, 'ZZZZ-2345');
  } finally {
    issuer.nextNumber = original;
  }
});

// -------------------------------------------------------------- logs

test('no log line holds the token, card data, the checkout link, the access code or the payload', async () => {
  const p = await pending();
  await postWebhook(t.url, success(p));
  const ticket = (await state(p.id)).ticket!;
  const all = t.logs.join('\n');
  assert.ok(t.logs.length > 0, 'nothing was captured, so this proves nothing');
  for (const secret of [ticket.token, p.authorizationUrl, p.accessCode, '4081', '408408', 'AUTH_secret123', 'walkin@gsds.com.ng', '"amount"']) {
    assert.ok(!all.includes(secret), `a log line contains ${secret}`);
  }
});
