import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { acceptedInit } from '../test-support/paystack';
import { addCategory, clearPending, startPayment } from '../test-support/payments';
import { ReconciliationService } from './reconciliation.service';

/**
 * What POST /payments actually schedules, read from the site's own payment
 * window. BullMQ is off in tests, so the queue is replaced by a recorder:
 * each delayed check becomes its own job with its own id.
 */

let t: TestApp;
let jobs: ReconciliationService;
let added: Array<{ name: string; reference: string; delay: number; jobId: string }>;

before(async () => {
  t = await bootTestApp();
  jobs = t.app.get(ReconciliationService);
  await addCategory(t, 'CAR', 50_000);
  // Stand in for BullMQ's queue: record what would be enqueued.
  (jobs as unknown as { queue: unknown }).queue = {
    add: async (name: string, data: { reference: string }, opts: { delay: number; jobId: string }) => {
      added.push({ name, reference: data.reference, delay: opts.delay, jobId: opts.jobId });
    },
  };
});
after(async () => {
  if (jobs) (jobs as unknown as { queue: unknown }).queue = null;
  await t?.close();
});
beforeEach(async () => {
  added = [];
  if (!t) return;
  await clearPending(t, t.users.entry.id);
  t.paystack.onInitialize = acceptedInit;
  await t.prisma.siteSetting.update({ where: { siteId: t.siteId }, data: { paymentWindowMinutes: 5 } });
});

test('accepted checkout, 5-minute window: five verify jobs at 20, 45, 90, 150, 240 s, distinct ids', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 201);
  const mine = added.filter((j) => j.reference === res.body.reference);
  assert.deepEqual(mine.map((j) => j.name), ['verify', 'verify', 'verify', 'verify', 'verify']);
  assert.deepEqual(mine.map((j) => j.delay), [20_000, 45_000, 90_000, 150_000, 240_000]);
  assert.equal(new Set(mine.map((j) => j.jobId)).size, 5, 'two checks share a job id, so one would be dropped');
});

test('a 1-minute window: only the checks inside it (20 and 45 s)', async () => {
  await t.prisma.siteSetting.update({ where: { siteId: t.siteId }, data: { paymentWindowMinutes: 1 } });
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 201);
  assert.deepEqual(added.map((j) => j.delay), [20_000, 45_000]);
  for (const j of added) assert.ok(j.delay < 60_000);
});

test('Paystack did not answer the start: 3 s first, then the window schedule', async () => {
  t.paystack.onInitialize = () => ({ outcome: 'unknown', authorizationUrl: null, accessCode: null, message: 'timeout' });
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 503);
  assert.deepEqual(added.map((j) => j.delay), [3_000, 20_000, 45_000, 90_000, 150_000, 240_000]);
});

test('Paystack refused the start: nothing scheduled (no charge exists)', async () => {
  t.paystack.onInitialize = () => ({ outcome: 'refused', authorizationUrl: null, accessCode: null, message: 'no' });
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  assert.equal(res.status, 502);
  assert.deepEqual(added, []);
});

test('a scheduled check changes nothing on its own: with no Paystack answer the payment stays PENDING', async () => {
  const res = await startPayment(t, t.users.entry.id, { categoryCode: 'CAR' });
  t.paystack.verifyAnswers.set(res.body.reference, { kind: 'unknown', data: null, message: 'timeout' });
  // Run every scheduled check, as the worker would, past the window.
  await t.prisma.$executeRawUnsafe(`UPDATE payment SET created_at = now() - interval '10 minutes' WHERE id = $1::uuid`, res.body.id);
  for (const j of added) await jobs.verifyOne(j.reference);
  const row = await t.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(row.status, 'PENDING');
});
