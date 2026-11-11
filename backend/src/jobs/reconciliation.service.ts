import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { SettlementService } from '../payments/settlement.service';
import { LATE_CHECK_MINUTES } from './verify-schedule';

/**
 * Two background jobs, both of which change a payment ONLY from Paystack's
 * answer (SettlementService.verifyAndApply):
 *
 *   verify   delayed checks after a payment starts, all inside the payment
 *            window (verify-schedule.ts): 20, 45, 90, 150 and 240 s for a
 *            webhook that never came, plus 3 s first when Paystack did not
 *            answer the start. Each is its own job (the delay is in the id).
 *   sweep    every 2 minutes, every PENDING payment older than 20 s, so a
 *            lost webhook resolves and an unpaid one is ABANDONED once past
 *            the payment window.
 *
 * Adapted from eparking backend/src/jobs/reconciliation.service.ts.
 * DISABLE_JOBS=1 turns the queue off (tests, scripts); the methods still work
 * when called directly.
 *
 * Redis must run with maxmemory-policy noeviction (docs/05-known-issues.md L3).
 */

export const VERIFY_FALLBACK_MS = 20_000;
export { LATE_CHECK_MINUTES };
const SWEEP_EVERY_MS = 2 * 60_000;
const QUEUE = 'qrpark-payments';

/**
 * Every job this app enqueues (delayed verifies, sweep runs) is removed once it
 * completes; at most 50 failed jobs are kept for a look. Redis runs with
 * maxmemory and noeviction (Sprint 6a, L3), so nothing may pile up in it: a
 * full Redis would refuse the payment locks (fail closed, 503).
 */
export const JOB_RETENTION = { removeOnComplete: true, removeOnFail: 50 } as const;

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly settlement: SettlementService,
  ) {}

  private connection(): ConnectionOptions {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      // BullMQ workers require this.
      maxRetriesPerRequest: null,
    };
  }

  async onModuleInit() {
    if (process.env.DISABLE_JOBS === '1') {
      this.logger.log('Background jobs disabled (DISABLE_JOBS=1)');
      return;
    }
    const connection = this.connection();
    this.queue = new Queue(QUEUE, { connection });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'verify') return this.verifyOne(job.data.reference as string);
        if (job.name === 'sweep') return this.sweep();
        return undefined;
      },
      { connection },
    );
    this.worker.on('failed', (job, error) => this.logger.error(`Job ${job?.name} failed: ${error.message}`));
    await this.scheduleSweep();
    this.logger.log('Payment reconciliation worker started');
  }

  /** The repeating payment sweep (one scheduler; each run removed when done). */
  async scheduleSweep(): Promise<void> {
    await this.queue?.upsertJobScheduler('payment-sweep', { every: SWEEP_EVERY_MS }, { name: 'sweep', opts: { ...JOB_RETENTION } });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /**
   * Schedule a verify. NEVER throws: by now the payment exists and may be in
   * the customer's hands; the sweep still picks it up if scheduling fails.
   */
  async scheduleVerify(reference: string, delayMs: number = VERIFY_FALLBACK_MS): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(
        'verify',
        { reference },
        { delay: delayMs, ...JOB_RETENTION, jobId: `verify-${delayMs}-${reference}` },
      );
    } catch (error) {
      this.logger.error(`Could not schedule a verify for ${reference}: ${(error as Error).message}. The sweep will pick it up.`);
    }
  }

  /**
   * One delayed check. PENDING: as before. A CARD payment that ended
   * ABANDONED or FAILED within LATE_CHECK_MINUTES (for example cancelled at
   * the booth before this check fired): asked again (T8).
   */
  async verifyOne(reference: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { reference }, select: { status: true } });
    if (!payment) return;
    if (payment.status === 'PENDING') return this.settlement.verifyAndApply(reference);
    if (payment.status === 'ABANDONED' || payment.status === 'FAILED') return this.settlement.verifyEnded(reference);
  }

  /** Every PENDING payment older than the fallback, oldest first, one at a time. */
  async sweep(): Promise<void> {
    const siteId = await this.site.getId();
    const stale = await this.prisma.payment.findMany({
      where: { siteId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - VERIFY_FALLBACK_MS) } },
      orderBy: { createdAt: 'asc' },
      select: { reference: true },
      take: 200,
    });
    // At most one Paystack call per payment per sweep: a payment this sweep
    // abandons in the PENDING pass is not asked again in the ended pass.
    const asked = new Set<string>();
    for (const { reference } of stale) {
      asked.add(reference);
      try {
        await this.settlement.verifyAndApply(reference);
      } catch (error) {
        this.logger.error(`Sweep could not check ${reference}: ${(error as Error).message}`);
      }
    }

    // T8: CARD payments that ended ABANDONED or FAILED within LATE_CHECK_MINUTES
    // (verifyEnded re-checks the time on the database clock).
    const ended = await this.prisma.$queryRaw<Array<{ reference: string }>>`
      SELECT reference FROM payment
       WHERE site_id = ${siteId}::uuid AND method = 'CARD' AND status IN ('ABANDONED', 'FAILED')
         AND updated_at >= now() - make_interval(mins => ${LATE_CHECK_MINUTES}::int)
       ORDER BY updated_at ASC
       LIMIT 200`;
    for (const { reference } of ended) {
      if (asked.has(reference)) continue;
      asked.add(reference);
      try {
        await this.settlement.verifyEnded(reference);
      } catch (error) {
        this.logger.error(`Sweep could not re-check ${reference}: ${(error as Error).message}`);
      }
    }
  }
}
