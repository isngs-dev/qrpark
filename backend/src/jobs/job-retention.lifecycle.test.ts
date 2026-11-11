import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { bootTestApp, type TestApp } from '../test-support/app';
import { JOB_RETENTION, ReconciliationService } from './reconciliation.service';

/**
 * Sprint 6a (L3): Redis runs with maxmemory 256 MB and noeviction, so nothing
 * may pile up in it for ever. Every job this app enqueues - each delayed
 * verify, and each run of the payment sweep - is removed once it completes,
 * and at most 50 failed jobs are kept. Checked on real BullMQ jobs in the test
 * Redis (a queue of this test's own, removed at the end), read back from Redis.
 */

let t: TestApp;
let jobs: ReconciliationService;
let queue: Queue;

before(async () => {
  t = await bootTestApp();
  jobs = t.app.get(ReconciliationService);
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  queue = new Queue(`qrpark-retention-test-${randomBytes(4).toString('hex')}`, {
    connection: { host: url.hostname, port: Number(url.port || 6379) },
  });
  (jobs as unknown as { queue: Queue }).queue = queue;
});
after(async () => {
  if (jobs) (jobs as unknown as { queue: unknown }).queue = null;
  await queue?.obliterate({ force: true }).catch(() => undefined);
  await queue?.close();
  await t?.close();
});

test('the retention: completed jobs removed, at most 50 failed kept', () => {
  assert.deepEqual(JOB_RETENTION, { removeOnComplete: true, removeOnFail: 50 });
});

test('a delayed verify, as stored in Redis, is removed on completion and caps failures', async () => {
  await jobs.scheduleVerify('QRP_RETENTION_TEST', 60_000);
  const job = await queue.getJob('verify-60000-QRP_RETENTION_TEST');
  assert.ok(job, 'the verify job is in Redis');
  assert.equal(job.opts.removeOnComplete, true);
  assert.equal(job.opts.removeOnFail, 50);
});

test('the payment sweep, as stored in Redis, is removed on completion and caps failures', async () => {
  await jobs.scheduleSweep();
  // With `every`, BullMQ puts the first run in at once (waiting), later ones delayed.
  const next = (await queue.getJobs(['waiting', 'delayed', 'prioritized'])).filter((j) => j.name === 'sweep');
  assert.equal(next.length, 1, 'one next sweep is queued');
  assert.equal(next[0].opts.removeOnComplete, true);
  assert.equal(next[0].opts.removeOnFail, 50);
});
