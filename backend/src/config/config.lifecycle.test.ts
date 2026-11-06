import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bootTestApp, call, type TestApp } from '../test-support/app';
import { fakeTicketNumber, fakeToken } from '../test-support/db';

/**
 * Categories and prices, settings and gates over HTTP, as ADMIN. Every change
 * is audited with before and after. See docs/api.md, "Admin".
 */

let t: TestApp;
let admin: string;
before(async () => {
  t = await bootTestApp();
  admin = await t.accessToken(t.users.admin.id);
});
after(() => t?.close());

const post = (path: string, body: unknown) => call(t, 'POST', path, { token: admin, body });
const patch = (path: string, body: unknown) => call(t, 'PATCH', path, { token: admin, body });
const get = (path: string) => call(t, 'GET', path, { token: admin });

async function lastAudit(targetId: string) {
  return t.prisma.auditLog.findFirst({ where: { siteId: t.siteId, targetId }, orderBy: { occurredAt: 'desc' } });
}

// ------------------------------------------------------------------ prices

const BAD_PRICES: Array<[string, unknown]> = [
  ['zero', 0],
  ['negative', -1],
  ['fraction', 1.5],
  ['string', '500'],
  ['null', null],
  ['boolean', true],
  ['over INTEGER', 2_147_483_648],
  ['huge', 1e20],
];

test('price validation on create: every bad priceKobo is 400 and creates nothing', async () => {
  for (const [label, priceKobo] of BAD_PRICES) {
    const code = `BAD_${randomBytes(3).toString('hex').toUpperCase()}`;
    const res = await post('/admin/categories', { code, name: 'Bad', priceKobo });
    assert.equal(res.status, 400, `${label} (${String(priceKobo)}) answered ${res.status}`);
    const row = await t.prisma.vehicleCategory.findFirst({ where: { siteId: t.siteId, code } });
    assert.equal(row, null, `${label} created a row`);
  }
  const missing = await post('/admin/categories', { code: 'NOPRICE', name: 'No price' });
  assert.equal(missing.status, 400, 'missing priceKobo was accepted');
});

test('price validation on create: 1 kobo and INTEGER max are accepted, stored exactly', async () => {
  for (const priceKobo of [1, 2_147_483_647]) {
    const code = `OK_${priceKobo}`;
    const res = await post('/admin/categories', { code, name: `Ok ${priceKobo}`, priceKobo });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.priceKobo, priceKobo);
    const row = await t.prisma.vehicleCategory.findFirstOrThrow({ where: { siteId: t.siteId, code } });
    assert.equal(row.priceKobo, priceKobo);
  }
});

test('price validation on update: every bad priceKobo is 400 and the price is unchanged', async () => {
  const created = await post('/admin/categories', { code: 'SUV', name: 'SUV', priceKobo: 50_000 });
  assert.equal(created.status, 201);
  for (const [label, priceKobo] of BAD_PRICES) {
    const res = await patch(`/admin/categories/${created.body.id}`, { priceKobo });
    assert.equal(res.status, 400, `${label} answered ${res.status}`);
  }
  const row = await t.prisma.vehicleCategory.findUniqueOrThrow({ where: { id: created.body.id } });
  assert.equal(row.priceKobo, 50_000);
});

test('a price change is audited with before and after, as CATEGORY_PRICE_CHANGED', async () => {
  const created = await post('/admin/categories', { code: 'VAN', name: 'Van', priceKobo: 70_000 });
  const res = await patch(`/admin/categories/${created.body.id}`, { priceKobo: 75_000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.priceKobo, 75_000);

  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'CATEGORY_PRICE_CHANGED');
  assert.equal(audit?.actorId, t.users.admin.id);
  assert.deepEqual(audit?.detail, { code: 'VAN', priceKobo: { from: 70_000, to: 75_000 } });
});

test('category create is audited; the code is normalised and can never change', async () => {
  const created = await post('/admin/categories', { code: 'bike', name: 'Bike', priceKobo: 20_000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, 'BIKE');
  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'CATEGORY_CREATED');
  assert.deepEqual(audit?.detail, { code: 'BIKE', name: 'Bike', priceKobo: 20_000 });

  const recode = await patch(`/admin/categories/${created.body.id}`, { code: 'MOTO' });
  assert.equal(recode.status, 400);

  const dup = await post('/admin/categories', { code: 'BIKE', name: 'Bike again', priceKobo: 1 });
  assert.equal(dup.status, 409);
});

test('category rename and deactivate are audited as CATEGORY_UPDATED', async () => {
  const created = await post('/admin/categories', { code: 'TRUCK', name: 'Truck', priceKobo: 100_000 });
  const res = await patch(`/admin/categories/${created.body.id}`, { name: 'Heavy truck', isActive: false });
  assert.equal(res.status, 200);
  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'CATEGORY_UPDATED');
  assert.deepEqual(audit?.detail, {
    code: 'TRUCK',
    name: { from: 'Truck', to: 'Heavy truck' },
    isActive: { from: true, to: false },
  });
  const list = await get('/admin/categories');
  assert.ok(list.body.some((c: { code: string; isActive: boolean }) => c.code === 'TRUCK' && !c.isActive));
});

test('an unknown field is refused, not silently ignored', async () => {
  const res = await post('/admin/categories', { code: 'LORRY', name: 'Lorry', priceKobo: 1, price: 5 });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------- settings

test('settings: read, then validity hours 1-72 only', async () => {
  const read = await get('/admin/settings');
  assert.equal(read.status, 200);
  assert.equal(read.body.validityHours, 12);

  for (const validityHours of [0, 73, 1.5, '12', null]) {
    const res = await patch('/admin/settings', { validityHours });
    assert.equal(res.status, 400, `validityHours ${String(validityHours)} answered ${res.status}`);
  }
  for (const validityHours of [72, 1, 12]) {
    const res = await patch('/admin/settings', { validityHours });
    assert.equal(res.status, 200);
    assert.equal(res.body.validityHours, validityHours);
  }
});

test('settings: a change is audited with before and after, only for what changed', async () => {
  const res = await patch('/admin/settings', { displayName: '  Garki Test Market ', receiptContactLine: 'Call 0800' });
  assert.equal(res.status, 200);
  assert.equal(res.body.displayName, 'Garki Test Market');
  const audit = await lastAudit(t.siteId);
  assert.equal(audit?.action, 'SETTINGS_CHANGED');
  assert.deepEqual(audit?.detail, {
    displayName: { from: 'Test Market', to: 'Garki Test Market' },
    receiptContactLine: { from: null, to: 'Call 0800' },
  });

  assert.equal((await patch('/admin/settings', { displayName: '   ' })).status, 400);
  assert.equal((await patch('/admin/settings', {})).status, 400);
});

test('settings: changing validity hours never changes a ticket already issued', async () => {
  const category = await t.prisma.vehicleCategory.create({
    data: { siteId: t.siteId, code: 'FIXED', name: 'Fixed', priceKobo: 10_000 },
  });
  const paidAt = new Date();
  const payment = await t.prisma.payment.create({
    data: {
      siteId: t.siteId,
      reference: `QRP-${randomBytes(8).toString('hex')}`,
      idempotencyKey: randomBytes(16).toString('hex'),
      operatorId: t.users.entry.id,
      gateId: t.entryGateId,
      categoryId: category.id,
      categoryCode: 'FIXED',
      categoryName: 'Fixed',
      amountKobo: 10_000,
      status: 'SUCCESS',
      paidAt,
    },
  });
  const validUntil = new Date(paidAt.getTime() + 12 * 3600_000);
  const ticket = await t.prisma.ticket.create({
    data: {
      siteId: t.siteId,
      paymentId: payment.id,
      token: fakeToken(),
      ticketNumber: fakeTicketNumber(),
      operatorId: t.users.entry.id,
      gateId: t.entryGateId,
      categoryName: 'Fixed',
      amountKobo: 10_000,
      paymentReference: payment.reference,
      paidAt,
      validityHours: 12,
      validUntil,
    },
  });

  assert.equal((await patch('/admin/settings', { validityHours: 2 })).status, 200);

  const after = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(after.validityHours, 12);
  assert.equal(after.validUntil.getTime(), validUntil.getTime());
});

// ------------------------------------------------------------------- gates

test('gates: create is audited; code and direction can never change', async () => {
  const created = await post('/admin/gates', { code: 'entry_2', name: 'Entry 2', direction: 'ENTRY' });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, 'ENTRY_2');
  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'GATE_CREATED');
  assert.deepEqual(audit?.detail, { code: 'ENTRY_2', name: 'Entry 2', direction: 'ENTRY' });

  assert.equal((await patch(`/admin/gates/${created.body.id}`, { direction: 'EXIT' })).status, 400);
  assert.equal((await patch(`/admin/gates/${created.body.id}`, { code: 'X' })).status, 400);
  assert.equal((await post('/admin/gates', { code: 'ENTRY_2', name: 'Dup', direction: 'ENTRY' })).status, 409);
  assert.equal((await post('/admin/gates', { code: 'G', name: 'Both', direction: 'BOTH' })).status, 400);
});

test('gates: rename and take out of service are audited as GATE_UPDATED', async () => {
  const created = await post('/admin/gates', { code: 'EXIT_9', name: 'Exit 9', direction: 'EXIT' });
  const res = await patch(`/admin/gates/${created.body.id}`, { name: 'Exit nine', isActive: false });
  assert.equal(res.status, 200);
  const audit = await lastAudit(created.body.id);
  assert.equal(audit?.action, 'GATE_UPDATED');
  assert.deepEqual(audit?.detail, {
    code: 'EXIT_9',
    name: { from: 'Exit 9', to: 'Exit nine' },
    isActive: { from: true, to: false },
  });
  const list = await get('/admin/gates');
  assert.ok(list.body.length >= 4);
});

test('an unknown id is 404, a malformed id 400', async () => {
  assert.equal((await patch(`/admin/gates/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, { name: 'x' })).status, 404);
  assert.equal((await patch('/admin/gates/not-a-uuid', { name: 'x' })).status, 400);
});
