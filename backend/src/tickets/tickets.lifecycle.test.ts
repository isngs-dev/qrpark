import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, call, type TestApp, type TestUser } from '../test-support/app';
import { postWebhook, successData } from '../test-support/paystack';
import { addCategory, addEntryOperator, clearPending, startPayment } from '../test-support/payments';

/**
 * GET /tickets/recent and POST /tickets/reprint. A reprint is the SAME QR,
 * for any entry operator of the site, ACTIVE tickets only, always audited
 * with the actor and the original issuer, and the token never in the audit.
 */

let t: TestApp;
let colleague: TestUser;
before(async () => {
  t = await bootTestApp();
  await addCategory(t, 'CAR', 50_000);
  colleague = await addEntryOperator(t, 'entry.colleague');
});
after(() => t?.close());
beforeEach(async () => {
  if (!t) return;
  await clearPending(t, t.users.entry.id);
  await clearPending(t, colleague.id);
});

async function issued(operatorId = t.users.entry.id) {
  const p = await startPayment(t, operatorId, { categoryCode: 'CAR', customerName: 'Ada' });
  await postWebhook(t.url, { event: 'charge.success', data: successData({ reference: p.body.reference, amountKobo: 50_000 }) });
  return t.prisma.ticket.findUniqueOrThrow({ where: { paymentId: p.body.id } });
}

const reprint = async (userId: string, body: unknown) =>
  call(t, 'POST', '/tickets/reprint', { token: await t.accessToken(userId), body });

test('recent: the operator\'s own tickets of the last 24 h, newest first, without the token', async () => {
  const a = await issued();
  const b = await issued();
  const theirs = await issued(colleague.id);
  const old = await issued();
  await t.prisma.$executeRawUnsafe(`UPDATE ticket SET issued_at = now() - interval '25 hours' WHERE id = $1::uuid`, old.id);

  const res = await call(t, 'GET', '/tickets/recent', { token: await t.accessToken(t.users.entry.id) });
  assert.equal(res.status, 200);
  const numbers = res.body.map((x: { ticketNumber: string }) => x.ticketNumber);
  assert.deepEqual(numbers.slice(0, 2), [b.ticketNumber, a.ticketNumber]);
  assert.ok(!numbers.includes(theirs.ticketNumber), 'another operator\'s ticket is listed');
  assert.ok(!numbers.includes(old.ticketNumber), 'a ticket older than 24 h is listed');
  assert.ok(!JSON.stringify(res.body).includes(a.token), 'the recent list carries the token');
  assert.equal(res.body[0].paymentId, (await t.prisma.ticket.findUniqueOrThrow({ where: { id: b.id } })).paymentId);
});

test('reprint by id, by a colleague: the SAME QR; audited with actor and issuer, no token', async () => {
  const ticket = await issued();
  const res = await reprint(colleague.id, { ticketId: ticket.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.token, ticket.token);
  assert.equal(res.body.ticketNumber, ticket.ticketNumber);

  const audit = await t.prisma.auditLog.findFirstOrThrow({
    where: { siteId: t.siteId, action: 'TICKET_REPRINTED', targetId: ticket.id },
    orderBy: { occurredAt: 'desc' },
  });
  assert.equal(audit.actorId, colleague.id);
  assert.deepEqual(audit.detail, {
    ticketNumber: ticket.ticketNumber,
    via: 'id',
    issuedBy: { id: t.users.entry.id, username: t.users.entry.username },
  });
  assert.ok(!JSON.stringify(audit).includes(ticket.token), 'the token is in the audit row');
});

test('reprint by ticket number, typed loosely: the same QR, audited via number', async () => {
  const ticket = await issued();
  const typed = ticket.ticketNumber.toLowerCase().replace('-', '');
  const res = await reprint(t.users.entry.id, { ticketNumber: ` ${typed} ` });
  assert.equal(res.status, 200);
  assert.equal(res.body.token, ticket.token);
  const audit = await t.prisma.auditLog.findFirstOrThrow({
    where: { siteId: t.siteId, action: 'TICKET_REPRINTED', targetId: ticket.id },
    orderBy: { occurredAt: 'desc' },
  });
  assert.equal((audit.detail as { via: string }).via, 'number');
});

test('reprint: used, expired, unknown and malformed all get the same 404, and nothing is audited', async () => {
  const used = await issued();
  await t.prisma.ticket.update({
    where: { id: used.id },
    data: { status: 'USED', usedAt: new Date(), usedGateId: t.exitGateId, usedById: t.users.exit.id },
  });
  const expired = await issued();
  // Move the whole ticket into the past, keeping valid_until = paid_at + hours.
  await t.prisma.$executeRawUnsafe(
    `UPDATE ticket SET paid_at = paid_at - interval '13 hours', valid_until = valid_until - interval '13 hours' WHERE id = $1::uuid`,
    expired.id,
  );
  const auditsBefore = await t.prisma.auditLog.count({ where: { siteId: t.siteId, action: 'TICKET_REPRINTED' } });

  const misses = [
    await reprint(t.users.entry.id, { ticketId: used.id }),
    await reprint(t.users.entry.id, { ticketNumber: used.ticketNumber }),
    await reprint(t.users.entry.id, { ticketId: expired.id }),
    await reprint(t.users.entry.id, { ticketNumber: 'ZZZZ-ZZZZ' }),
    await reprint(t.users.entry.id, { ticketNumber: 'not-a-number' }),
    await reprint(t.users.entry.id, { ticketId: '00000000-0000-4000-8000-000000000000' }),
  ];
  for (const res of misses) assert.equal(res.status, 404, JSON.stringify(res.body));
  const bodies = new Set(misses.map((r) => JSON.stringify(r.body)));
  assert.equal(bodies.size, 1, `different 404 bodies: ${[...bodies].join(' | ')}`);
  assert.ok(!JSON.stringify(misses).includes(used.token) && !JSON.stringify(misses).includes(expired.token));
  assert.equal(await t.prisma.auditLog.count({ where: { siteId: t.siteId, action: 'TICKET_REPRINTED' } }), auditsBefore);
});

test('reprint: exactly one of ticketId or ticketNumber', async () => {
  const ticket = await issued();
  assert.equal((await reprint(t.users.entry.id, {})).status, 400);
  assert.equal((await reprint(t.users.entry.id, { ticketId: ticket.id, ticketNumber: ticket.ticketNumber })).status, 400);
});
